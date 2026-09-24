"""Workbook signatures and reporting periods, independent of filenames."""
from datetime import date, datetime
import re
import openpyxl


def inspect_workbook(path):
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        sheets = book.sheetnames
        rows = [list(r) for sheet in list(book)[:2] for r in sheet.iter_rows(max_row=6, max_col=18, values_only=True)]
        text = ' '.join(str(v) for r in rows for v in r if v is not None).lower().replace('ё', 'е')
        family = None
        # Appendices are exception lists, never complete denominator sources.
        if 'перечень твсп' in text and 'не обеспечивших' in text:
            return {'family': None, 'reason': 'Приложение со списком исключений; нет адаптера полного показателя'}
        if 'Все врачи_Детализация по МО' in sheets and 'Врачи по спец-тям_По МО' in sheets:
            family = 'physicians'
        elif 'закрытые случаи догвн/пмо' in text and '122' in text and '228' in text:
            family = 'preventive_remd'
        elif 'количество обращений с профилактической целью' in text and '228' in text:
            family = 'preventive_foms'
        elif 'посредством национального мессенджера' in text and ('мах' in text or 'max' in text):
            family = 'max_tmk_eln'
        elif 'выданные медицинские свидетельства о смерти' in text:
            family = 'death_certificates'
        elif 'выданные медицинские свидетельства о рождении' in text:
            family = 'birth_certificates'
        elif 'отказы в регистрации эмд' in text and 'код сообщения' in text:
            family = 'remd_errors'
        elif 'Краткий ввод' in sheets and 'случаев краткого ввода' in text:
            family = 'short_input'
        elif 'отправка сведений в федеральные сервисы' in text and 'количество карт' in text:
            family = 'asu_smp'
        elif 'Отчет РЭМД по МО' in sheets:
            family = 'elmk'
        elif ('твсп' in text or 'станци' in text) and ('Факт передачи' in sheets or 'Детализация по СП' in sheets):
            if 'протокол диагностических' in text: family = 'tvsp_diagnostic'
            elif 'протокол лабораторного' in text: family = 'tvsp_laboratory'
            elif 'эпикриз в стационаре' in text: family = 'tvsp_stationary'
            elif 'амбулатор' in text: family = 'tvsp_ambulatory'
            elif 'скорой' in text or 'смп' in text: family = 'smp_tvsp'
        elif 'телемедицинск' in text and 'Детализированный отчет' in sheets:
            family = 'tmk_remd'
        elif 'фап' in text and ('фп' in text or 'фельдшерск' in text):
            family = 'fap_fp'
        elif 'прикреплен' in text and 'заявлен' in text:
            family = 'egpu_attachment'
        elif 'госпитализац' in text and 'oid' in text:
            family = 'hospital_cases'
        elif 'законченному случаю' in text and 'амбулатор' in text:
            family = 'ambulatory_cases'
        elif 'путев' in text and ('транспорт' in text or 'использован' in text):
            family = 'electronic_waybill'
        periods = []
        for row in rows:
            label = ' '.join(str(v) for v in row if v is not None).lower()
            # Generation timestamps are not reporting cut dates.
            if ('период' not in label and 'выданные медицинские свидетельства' not in label) or label.startswith('дата формирования'):
                continue
            dates = [v.date() if isinstance(v, datetime) else v for v in row if isinstance(v, date)]
            for d, m, y in re.findall(r'(?<!\d)(\d{2})[.](\d{2})[.](20\d{2})', label.split('Дата формирования')[0]):
                dates.append(date(int(y), int(m), int(d)))
            if dates:
                # Excel reports can include unrelated hidden technical dates after columns C/D.
                dates = dates[:2]
                if len(dates) >= 2: periods.append((min(dates), max(dates)))
        if family == 'remd_errors':
            bounds = [v.date() if isinstance(v, datetime) else v for row in rows if 'периода' in str(row[0]).lower() for v in row if isinstance(v, date)]
            if len(bounds) >= 2: periods.append((min(bounds), max(bounds)))
        if family == 'physicians':
            formed = [v.date() for row in rows if 'Дата формирования' in str(row[0]) for v in row if isinstance(v, datetime)]
            if formed: periods.append((formed[0].replace(day=1), formed[0]))
        if family in ('tvsp_ambulatory', 'tvsp_stationary', 'tvsp_laboratory'):
            # BI TVSP exports encode the reporting window as year + month range
            # (e.g. "Январь-Сентябрь") and the actual cut date as generation date.
            # For the current cumulative year-to-date source, use 01.01 through that cut date.
            formed = [v.date() for row in rows if 'Дата формирования' in str(row[0]) for v in row if isinstance(v, datetime)]
            month_range = any('январь-сентябрь' in ' '.join(str(v).lower() for v in row if v is not None) for row in rows)
            if formed and month_range: periods.append((date(formed[0].year, 1, 1), formed[0]))
        unique = sorted(set(periods))
        result = {'family': family, 'sheets': sheets}
        if len(unique) > 1:
            result['error'] = 'На листах указаны разные отчетные периоды'
        elif unique:
            start, end = unique[0]
            result.update(startDate=start.isoformat(), endDate=end.isoformat())
        return result
    finally:
        book.close()
