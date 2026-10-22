// =====================================================================
// 家醫科住院醫師 EPA 學習評量 — Power Query (M) 程式碼
// 使用方式:Power BI Desktop → 轉換資料 → 新增來源 → 空白查詢 → 進階編輯器,
//          依下列「Query:」標題逐一建立同名查詢並貼上內容。
// 建立順序:參數 → dim_EPA → dim_信賴等級 → dim_職級 → fnEPA_標準化 → fact_EPA
//          → dim_期間 → dim_住院醫師
// =====================================================================


// ===== Query: 資料夾路徑 (參數) =====================================
// 放所有年度原始檔的根資料夾;子資料夾會一併讀取。
// 建議每年一個子資料夾,例如 ...\統整\202701\emyway 2026\
"D:\OneDrive\01_臨床與行政\milestone_EPA\統整" meta [IsParameterQuery = true, Type = "Text", IsParameterQueryRequired = true]


// ===== Query: 工作表名稱 (參數) =====================================
// 要讀取的工作表名稱;找不到時自動讀取活頁簿第一張工作表。
"RAW DATA" meta [IsParameterQuery = true, Type = "Text", IsParameterQueryRequired = false]


// ===== Query: dim_EPA ===============================================
let
    Source = #table(
        type table [EPA編號 = Int64.Type, EPA代碼 = text, EPA名稱 = text, EPA標籤 = text],
        {
            {1,  "EPA1",  "戒菸服務",       "EPA1 戒菸服務"},
            {2,  "EPA2",  "門診/社區衛教",  "EPA2 門診/社區衛教"},
            {3,  "EPA3",  "預防注射",       "EPA3 預防注射"},
            {4,  "EPA4",  "旅遊門診",       "EPA4 旅遊門診"},
            {5,  "EPA5",  "健康檢查",       "EPA5 健康檢查"},
            {6,  "EPA6",  "社區篩檢",       "EPA6 社區篩檢"},
            {7,  "EPA7",  "慢性病照護",     "EPA7 慢性病照護"},
            {8,  "EPA8",  "急性病診療",     "EPA8 急性病診療"},
            {9,  "EPA9",  "居家整合醫療",   "EPA9 居家整合醫療"},
            {10, "EPA10", "出院準備",       "EPA10 出院準備"},
            {11, "EPA11", "末病照護",       "EPA11 末病照護"},
            {12, "EPA12", "悲傷支持",       "EPA12 悲傷支持"}
        })
in
    Source


// ===== Query: dim_信賴等級 ==========================================
// 換算沿用 EPA_1120711.xlsx「換算」工作表:1a=1 … 4b=9, 5=10。
// 只填主等級(如 "3")者,分數留空,但主等級仍可分析。
let
    Source = #table(
        type table [信賴程度 = text, 分數 = Int64.Type, 主等級 = Int64.Type, 主等級說明 = text],
        {
            {"1a", 1,  1, "1 僅能觀察"},
            {"1b", 2,  1, "1 僅能觀察"},
            {"2a", 3,  2, "2 直接督導下執行"},
            {"2b", 4,  2, "2 直接督導下執行"},
            {"3a", 5,  3, "3 間接督導下執行"},
            {"3b", 6,  3, "3 間接督導下執行"},
            {"3c", 7,  3, "3 間接督導下執行"},
            {"4a", 8,  4, "4 可獨立執行"},
            {"4b", 9,  4, "4 可獨立執行"},
            {"5",  10, 5, "5 可指導他人"},
            {"1",  null, 1, "1 僅能觀察"},
            {"2",  null, 2, "2 直接督導下執行"},
            {"3",  null, 3, "3 間接督導下執行"},
            {"4",  null, 4, "4 可獨立執行"}
        })
in
    Source


// ===== Query: dim_職級 ==============================================
// 期望主等級:各職級年底「應達到」的信賴主等級,供「低於期望」判定;請依科內共識修改。
let
    Source = #table(type table [職級 = text, 職級排序 = Int64.Type, 期望主等級 = Int64.Type],
        {{"R1", 1, 3}, {"R2", 2, 3}, {"R3", 3, 4}, {"R4", 4, 4}})
in
    Source


// ===== Query: fnEPA_標準化 (函式) ===================================
// 把單一工作表(寬表或長表)整理成一列一筆「人 × EPA × 期間」的長表。
//  寬表:姓名 | 職級 | (期間 或 評量日期) | EPA1… | EPA12   ← 2023 年 RAW DATA 即此格式
//  長表:姓名 | 職級 | 評量日期 | EPA | 信賴程度         ← 逐筆評量匯出常見格式
(raw as table, sourceName as text, folderName as text) as table =>
let
    // ---- 1. 找表頭列(含姓名欄且至少 3 個非空儲存格),略過上方標題列 ----
    NameKeys = {"姓名", "NAME", "受評者", "學員"},
    CellText = (v) => let t = try Text.From(v) otherwise null in if t = null then "" else Text.Upper(Text.Trim(t)),
    IsHeaderRow = (r as record) as logical =>
        let cells = List.Transform(Record.FieldValues(r), CellText)
        in  List.Count(List.Select(cells, each _ <> "")) >= 3
            and List.AnyTrue(List.Transform(cells, (c) => List.AnyTrue(List.Transform(NameKeys, (k) => Text.Contains(c, k))))),
    Skipped  = Table.Skip(raw, each not IsHeaderRow(_)),
    Promoted = Table.PromoteHeaders(Skipped, [PromoteAllScalars = true]),
    CleanNames = Table.TransformColumnNames(Promoted, each Text.Trim(Text.Replace(Text.Replace(_, "#(lf)", ""), "#(cr)", ""))),

    // ---- 2. 欄名同義字對應 ----
    Synonyms = {
        {"NAME", "姓名"}, {"Name", "姓名"}, {"受評者", "姓名"}, {"受評者姓名", "姓名"}, {"學員姓名", "姓名"}, {"學員", "姓名"},
        {"R", "職級"}, {"級職", "職級"}, {"年級", "職級"},
        {"評核日期", "評量日期"}, {"評估日期", "評量日期"}, {"填寫日期", "評量日期"}, {"日期", "評量日期"},
        {"EPA項目", "EPA"}, {"評量項目", "EPA"},
        {"信賴等級", "信賴程度"}, {"信任程度", "信賴程度"}, {"等級", "信賴程度"}, {"Level", "信賴程度"},
        {"學期", "期間"}, {"半年", "期間"}, {"年度", "評量年度"},
        {"Year", "屆別"}
    },
    Cols0      = Table.ColumnNames(CleanNames),
    Applicable = List.Select(Synonyms, each List.Contains(Cols0, _{0}) and not List.Contains(Cols0, _{1})),
    NoDupTarget = List.Accumulate(Applicable, {}, (s, p) => if List.Contains(List.Transform(s, each _{1}), p{1}) then s else s & {p}),
    Renamed    = Table.RenameColumns(CleanNames, NoDupTarget),

    // ---- 3. 寬表 → 長表 ----
    Cols    = Table.ColumnNames(Renamed),
    IsLong  = List.Contains(Cols, "EPA") and List.Contains(Cols, "信賴程度"),
    EpaCols = List.Select(Cols, each Text.StartsWith(Text.Upper(_), "EPA") and _ <> "EPA"),
    Long =
        if IsLong then Table.RenameColumns(Renamed, {{"EPA", "EPA原始"}})
        else Table.UnpivotOtherColumns(Renamed, List.Difference(Cols, EpaCols), "EPA原始", "信賴程度"),
    Ensured = List.Accumulate({"姓名", "職級", "評量日期", "期間", "評量年度", "屆別"}, Long,
        (t, c) => if Table.HasColumns(t, c) then t else Table.AddColumn(t, c, each null)),

    // ---- 4. 解析工具 ----
    // 年份:檔名優先,其次所在資料夾名稱(例如 "emyway 2026")
    YearIn  = (s as text) => let c = List.Select({2010..2050}, (y) => Text.Contains(s, Text.From(y))) in if List.IsEmpty(c) then null else List.Max(c),
    FileYear = let a = YearIn(sourceName) in if a <> null then a else YearIn(folderName),
    // 日期:支援西元與民國 (115/03/15)
    ToDate = (v) =>
        if v = null then null else
        let d = try Date.From(v) otherwise null in
        if d <> null and Date.Year(d) > 1990 then d else
        let parts = Text.SplitAny(Text.From(v), "/-."),
            y = try Number.FromText(parts{0}) otherwise null
        in  if y <> null and y < 200
            then try #date(y + 1911, Number.FromText(parts{1}), Number.FromText(Text.Start(Text.Trim(parts{2}), 2))) otherwise null
            else null,
    RankOf = (v) =>
        let t = CellText(v), pos = Text.PositionOf(t, "R")
        in  if pos < 0 then null else
            let d = Text.Middle(t, pos + 1, 1) in if List.Contains({"1", "2", "3", "4", "5"}, d) then "R" & d else null,
    EpaNo = (v) =>
        let t  = CellText(v),
            a  = if Text.Contains(t, "EPA") then Text.AfterDelimiter(t, "EPA") else t,
            a2 = Text.TrimStart(a, {" ", "-", "_"}),
            ds = Text.Combine(List.FirstN(Text.ToList(a2), each List.Contains({"0".."9"}, _)))
        in  try Number.FromText(ds) otherwise null,
    LevelOf = (v) =>
        let t  = Text.Lower(CellText(v)),
            t2 = Text.Remove(Text.Replace(Text.Replace(t, "level", ""), "等級", ""), {" ", "　", "-", "_"}),
            t3 = if t2 = "5a" or t2 = "5b" or t2 = "5.0" then "5" else t2
        in  if t3 = "" then null else t3,
    HalfOf = (date, period, rank) =>
        if date <> null then (if Date.Month(date) <= 6 then 1 else 2) else
        let p = CellText(period) & "|" & CellText(rank) in
        if Text.Contains(p, "7-12") or Text.Contains(p, "7~12") or Text.Contains(p, "下") or Text.Contains(p, "後") or Text.Contains(p, "H2") then 2
        else if Text.Contains(p, "1-6") or Text.Contains(p, "1~6") or Text.Contains(p, "上") or Text.Contains(p, "前") or Text.Contains(p, "H1") then 1
        else null,

    // ---- 5. 產生標準欄位 ----
    WithDate = Table.TransformColumns(Ensured, {{"評量日期", ToDate}}),
    Out = Table.AddColumn(WithDate, "rec", each
        let yr0 = try Number.From([評量年度]) otherwise null,
            yr  = if [評量日期] <> null then Date.Year([評量日期])
                  else if yr0 <> null then (if yr0 < 200 then yr0 + 1911 else yr0)
                  else FileYear,
            h   = HalfOf([評量日期], [期間], [職級])
        in  [
                姓名       = Text.Trim(Text.From([姓名])),
                職級       = RankOf([職級]),
                評量日期   = [評量日期],
                年度       = yr,
                半年       = h,
                EPA編號    = EpaNo([EPA原始]),
                信賴程度   = LevelOf([信賴程度]),
                屆別       = [屆別],
                來源檔案   = sourceName
            ]),
    Recs  = Table.FromRecords(Out[rec],
                type table [姓名 = text, 職級 = text, 評量日期 = date, 年度 = Int64.Type, 半年 = Int64.Type,
                            EPA編號 = Int64.Type, 信賴程度 = text, 屆別 = any, 來源檔案 = text]),
    Valid = Table.SelectRows(Recs, each [姓名] <> null and [姓名] <> "" and [EPA編號] <> null and [EPA編號] >= 1 and [EPA編號] <= 12 and [信賴程度] <> null)
in
    Valid


// ===== Query: fact_EPA ==============================================
let
    Source   = Folder.Files(資料夾路徑),
    Filtered = Table.SelectRows(Source, each
                   List.Contains({".xlsx", ".xlsm", ".xls", ".csv"}, Text.Lower([Extension]))
                   and not Text.StartsWith([Name], "~$")),
    WithData = Table.AddColumn(Filtered, "資料", (f) =>
        let
            folderName = List.Last(List.RemoveItems(Text.Split(f[Folder Path], "\"), {""})),
            raw =
                if Text.Lower(f[Extension]) = ".csv" then
                    Csv.Document(f[Content], [Encoding = 65001, QuoteStyle = QuoteStyle.Csv])
                else
                    let wb     = Excel.Workbook(f[Content], null, true),
                        sheets = Table.SelectRows(wb, each [Kind] = "Sheet"),
                        named  = Table.SelectRows(sheets, each [Name] = 工作表名稱)
                    in  if Table.IsEmpty(named) then sheets{0}[Data] else named{0}[Data]
        in
            try fnEPA_標準化(raw, f[Name], folderName) otherwise #table({}, {})),
    Combined = Table.Combine(WithData[資料]),
    Typed    = Table.TransformColumnTypes(Combined, {
                   {"姓名", type text}, {"職級", type text}, {"評量日期", type date}, {"年度", Int64.Type},
                   {"半年", Int64.Type}, {"EPA編號", Int64.Type}, {"信賴程度", type text}, {"來源檔案", type text}}),
    Merged   = Table.NestedJoin(Typed, {"信賴程度"}, dim_信賴等級, {"信賴程度"}, "lv", JoinKind.LeftOuter),
    Expanded = Table.ExpandTableColumn(Merged, "lv", {"分數", "主等級"}),
    // 期間序號:連續半年編號,方便計算「前一期」;期間鍵:例 20261 = 2026 上半年
    AddSeq   = Table.AddColumn(Expanded, "期間序號", each if [年度] = null or [半年] = null then null else [年度] * 2 + [半年] - 1, Int64.Type),
    AddKey   = Table.AddColumn(AddSeq, "期間鍵", each if [年度] = null or [半年] = null then null else [年度] * 10 + [半年], Int64.Type),
    AddRowId = Table.AddIndexColumn(AddKey, "列號", 1, 1, Int64.Type)
in
    AddRowId


// ===== Query: dim_期間 ==============================================
let
    Source  = Table.Distinct(Table.SelectColumns(Table.SelectRows(fact_EPA, each [期間序號] <> null), {"期間序號", "期間鍵", "年度", "半年"})),
    Label   = Table.AddColumn(Source, "半年標籤", each if [半年] = 1 then "上半年(1–6月)" else "下半年(7–12月)", type text),
    Period  = Table.AddColumn(Label, "期間標籤", each Text.From([年度]) & " " & (if [半年] = 1 then "上半年" else "下半年"), type text),
    Sorted  = Table.Sort(Period, {{"期間序號", Order.Ascending}})
in
    Sorted


// ===== Query: dim_住院醫師 ==========================================
let
    Source = Table.Distinct(Table.SelectColumns(fact_EPA, {"姓名"})),
    Sorted = Table.Sort(Source, {{"姓名", Order.Ascending}})
in
    Sorted
