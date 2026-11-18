import csv
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = root / 'data_sources' / '2026-11-18' / 'semd-registration-time-video.csv'
target = Path(__file__).resolve().parents[1] / 'app' / 'remd-registration-time.json'
with source.open(encoding='utf-8-sig', newline='') as stream:
    rows = list(csv.DictReader(stream, delimiter=';'))
data = {
    'period': '01.11–17.11.2026',
    'source': 'Федеральная BI ЕГИСЗ, видеозапись экрана от 18.11.2026',
    'unit': 'часы и минуты, как показано в рейтинге источника',
    'methodNote': 'Показатель времени из федерального графика. Не является долей СЭМД, зарегистрированных в течение 1 дня после подписания.',
    'rows': [
        {'rank': int(row['Ранг']), 'name': row['МО (как на видео)'], 'hours': int(row['Часы']), 'minutes': int(row['Минуты']), 'note': row['Примечание']}
        for row in rows
    ],
}
target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(len(rows))
