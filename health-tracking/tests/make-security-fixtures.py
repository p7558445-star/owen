"""產生資安測試用的惡意檔案（全部為虛構資料）：XSS／公式注入名冊、壓縮炸彈。
用法：python3 make-security-fixtures.py <輸出資料夾>"""
import os, sys, zipfile
import openpyxl

out = sys.argv[1] if len(sys.argv) > 1 else 'sec'
os.makedirs(out, exist_ok=True)
wb = openpyxl.Workbook(); ws = wb.active; ws.title = '1-測試社區'
ws.append(['優活雲批次建立個案名單填寫表']); ws.append(['說明'])
ws.append(['個案姓名＊', '性別＊', '生日＊', '身高＊', '身份識別類型＊', '識別值＊', '手機號碼', '所屬據點＊'])
ws.append(['王大明', '男', '40.07.20', 165, '身分證號碼', 'A123456789', '0912000000', '測試社區'])
ws.append(['<img src=x onerror=alert(1)>', '女', '1950-01-01', 155, '身分證號碼', 'B223456787', '0912000001', '<script>alert(2)</script>'])
ws.append(['=HYPERLINK("http://evil","x")', '女', '1951-02-02', 150, '身分證號碼', 'C200000000', '0912000002', '測試社區'])
roster = os.path.join(out, 'evil_roster.xlsx'); wb.save(roster)
src = zipfile.ZipFile(roster)
with zipfile.ZipFile(os.path.join(out, 'bomb.xlsx'), 'w', zipfile.ZIP_DEFLATED) as z:
    for n in src.namelist():
        data = src.read(n)
        if n == 'xl/worksheets/sheet1.xml':  # 解壓後約 100 MB
            data = data.replace(b'</sheetData>', b'</sheetData><!--' + b' ' * (100 * 1024 * 1024) + b'-->')
        z.writestr(n, data)
print('fixtures written to', out)
