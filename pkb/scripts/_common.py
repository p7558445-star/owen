"""共用工具：vault 路徑、frontmatter、Claude API 呼叫。"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
from pathlib import Path

import yaml

VAULT = Path(__file__).resolve().parent.parent
INBOX = VAULT / "00-Inbox"
MODEL = os.environ.get("PKB_MODEL", "claude-opus-5-5")

FOLDERS = {
    "00-Inbox": "無法判斷",
    "10-Research": "研究（protocol、分析、論文草稿、研究進度）",
    "20-Grants": "計畫書、經費申請、IRB 文件",
    "30-Literature": "單篇或多篇文獻的閱讀筆記",
    "40-Clinical": "臨床知識、教學、病例討論（去識別化）",
    "50-Meetings": "會議紀錄",
    "60-Admin": "行政：公文、委員會、申請流程、核銷",
    "70-Journal": "工作日誌、反思、經驗",
    "80-Resources": "SOP、統計方法、程式碼、參考資料",
}
TYPES = ["research", "grant", "literature", "clinical", "meeting", "admin", "journal", "resource"]


def today() -> str:
    return dt.date.today().isoformat()


def slug(text: str, maxlen: int = 40) -> str:
    text = re.sub(r"[\\/:*?\"<>|#^\[\]\n\r\t]", " ", text).strip()
    text = re.sub(r"\s+", "-", text)
    return text[:maxlen].strip("-") or "untitled"


def split_frontmatter(text: str) -> tuple[dict, str]:
    if text.startswith("---\n"):
        end = text.find("\n---", 4)
        if end != -1:
            try:
                meta = yaml.safe_load(text[4:end]) or {}
                if isinstance(meta, dict):
                    return meta, text[end + 4 :].lstrip("\n")
            except yaml.YAMLError:
                pass
    return {}, text


def join_frontmatter(meta: dict, body: str) -> str:
    fm = yaml.safe_dump(meta, allow_unicode=True, sort_keys=False).strip()
    return f"---\n{fm}\n---\n\n{body.rstrip()}\n"


def unique_path(path: Path) -> Path:
    """不覆蓋既有檔案：重名時加 -2、-3…"""
    if not path.exists():
        return path
    i = 2
    while (p := path.with_name(f"{path.stem}-{i}{path.suffix}")).exists():
        i += 1
    return p


def write_note(path: Path, meta: dict, body: str) -> Path:
    path = unique_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(join_frontmatter(meta, body), encoding="utf-8")
    return path


def rel(path: Path) -> str:
    return path.resolve().relative_to(VAULT).as_posix()


def vault_rules() -> str:
    return (VAULT / "CLAUDE.md").read_text(encoding="utf-8")


def role(name: str) -> str:
    return (VAULT / "_ai" / "roles" / f"{name}.md").read_text(encoding="utf-8")


class ClaudeError(RuntimeError):
    pass


def ask_claude(
    content,
    system: str,
    *,
    effort: str = "medium",
    schema: dict | None = None,
    max_tokens: int = 16000,
):
    """呼叫 Claude。schema 有給時回傳 dict（結構化輸出），否則回傳文字。

    啟用伺服器端 fallback：若主模型因安全分類拒答（醫療內容偶有誤判），
    API 會在同一請求內改由後備模型完成。
    """
    import anthropic

    client = anthropic.Anthropic()
    output_config: dict = {"effort": effort}
    if schema:
        output_config["format"] = {"type": "json_schema", "schema": schema}
    if isinstance(content, str):
        content = [{"type": "text", "text": content}]
    try:
        resp = client.beta.messages.create(
            model=MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": content}],
            output_config=output_config,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except TypeError as e:  # SDK 找不到任何認證方式
        raise ClaudeError("未設定 API 認證：請 export ANTHROPIC_API_KEY 或執行 `ant auth login`") from e
    except anthropic.AuthenticationError as e:
        raise ClaudeError("API 金鑰無效或未設定（ANTHROPIC_API_KEY 或 `ant auth login`）") from e
    except anthropic.RateLimitError as e:
        raise ClaudeError("達到速率上限，稍後再試") from e
    except anthropic.APIStatusError as e:
        raise ClaudeError(f"API 錯誤 {e.status_code}: {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise ClaudeError("無法連線到 Claude API") from e

    if resp.stop_reason == "refusal":
        raise ClaudeError("模型拒絕處理此內容（請檢查是否含敏感資料）")
    text = "".join(b.text for b in resp.content if b.type == "text")
    if resp.stop_reason == "max_tokens":
        print("⚠️  輸出達到長度上限，內容可能不完整")
    if schema:
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            raise ClaudeError(f"結構化輸出解析失敗：{text[:200]}") from e
    return text
