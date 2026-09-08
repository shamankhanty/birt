#!/usr/bin/env python3
"""Deterministic source adapters for stage-8 staging updates.

Adapters may write only to a supplied staging app directory. They never touch
ROOT/app directly. They preserve the stage-6 registry as the authority for
metadata; source workbooks provide facts/components only.
"""
from __future__ import annotations

import calendar
import json
import math
import re
import shutil
import subprocess
import tempfile
from collections import Counter, defaultdict
from dataclasses import dataclass, asdict
from datetime import date
from pathlib import Path
from typing import Iterable

import openpyxl


@dataclass
class AdapterResult:
    adapter: str
    families: list[str]
    status: str
    changedFiles: list[str]
    sourceFiles: list[str]
    facts: dict
    warnings: list[str]
    errors: list[str]

    def dict(self):
        return asdict(self)


def load(app: Path, name: str):
    return json.loads((app / name).read_text(encoding="utf-8"))


def save(app: Path, name: str, data):
    (app / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def n(v) -> int:
    try:
        return int(float(v or 0))
    except (TypeError, ValueError):
        return 0


def norm(v) -> str:
    s = str(v or "").lower().replace("ё", "е")
    s = re.sub(r'["«»]', "", s)
    s = re.sub(r'^(?:гауз|гбуз|гбу|фгбу|фгауз|фгаоу\s*во|ао|ооо|чуз)(?:\s+рт)?\s+', '', s)
    return re.sub(r'[^а-яa-z0-9№]+', ' ', s).strip()


def parse_iso(s: str | None) -> date | None:
    return date.fromisoformat(s) if s else None


def date_ru(d: date) -> str:
    return d.strftime("%d.%m.%Y")


def period_cumulative(d: date) -> str:
    return f"01.01–{date_ru(d)}"


def month_label(d: date) -> str:
    months = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"]
    return f"{months[d.month-1]} {d.year}"


def previous_month_label(d: date) -> str:
    y, m = (d.year - 1, 12) if d.month == 1 else (d.year, d.month - 1)
    return month_label(date(y, m, 1)).capitalize()


def current_label(d: date) -> str:
    return f"На {date_ru(d)[:5]}"


def previous_rows_from_dataset(ds: dict) -> dict[str, dict]:
    return {(str(r.get("oid")) if r.get("oid") else norm(r.get("name"))): r for r in ds.get("rows", [])}


def monthly_payload(previous_rows: dict[str, dict], current_rows: list[dict], d: date, unit: str = "%") -> dict:
    out = []
    for x in current_rows:
        k = str(x.get("oid")) if x.get("oid") else norm(x.get("name"))
        old = previous_rows.get(k)
        pv = old.get("fact") if old else None
        cq = x.get("quantity")
        if cq is None and x.get("count") is not None and x.get("volume") is not None:
            cq = f"{x['count']:,} / {x['volume']:,}".replace(",", " ")
        pq = None
        if old:
            if old.get("count") is not None and old.get("volume") is not None:
                pq = f"{old['count']:,} / {old['volume']:,}".replace(",", " ")
            else:
                pq = old.get("quantity")
        out.append({
            "name": x["name"], "june": pv, "july": x.get("fact"),
            "change": None if pv is None else x.get("fact") - pv,
            "juneQuantity": pq, "julyQuantity": cq,
        })
    prev_end_month = d.month - 1 or 12
    prev_year = d.year if d.month > 1 else d.year - 1
    prev_end = date(prev_year, prev_end_month, calendar.monthrange(prev_year, prev_end_month)[1])
    return {"unit": unit, "previousLabel": current_label(prev_end), "currentLabel": current_label(d), "rows": out}


def _sheet(wb, preferred: Iterable[str]):
    for name in preferred:
        if name in wb.sheetnames:
            return wb[name]
    return wb.active


def parse_egpu(path: Path, col: int) -> list[dict]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = _sheet(wb, ["Отчет", "Отчёт"])
    out = []
    for r in ws.iter_rows(min_row=4, values_only=True):
        if len(r) <= col or not r[2]:
            continue
        den, num = n(r[4]), n(r[col])
        out.append({"name": str(r[2]), "oid": str(r[3] or ""), "fact": num / den * 100 if den else 0, "count": num, "volume": den})
    if not out:
        raise ValueError("ПР_2: не найдено строк данных")
    return out


def adapt_egpu(app: Path, source: Path, end: date) -> AdapterResult:
    mo, details, oids, monthly = (load(app, x) for x in ["mo-data.json", "mo-details.json", "mo-detail-oids.json", "monthly-mo.json"])
    facts = {}
    for metric, col, title in [
        ("egpu", 5, "Доля заявлений на прикрепление с финальным статусом"),
        ("egpu2days", 6, "Доля заявлений на прикрепление, рассмотренных за 2 рабочих дня"),
    ]:
        cur = parse_egpu(source, col)
        prev = previous_rows_from_dataset(mo.get(metric, {}))
        dn, do, rows = {}, {}, []
        for x in cur:
            old = prev.get(x["oid"] or norm(x["name"]))
            row = {"name": x["name"], "oid": x["oid"], "fact": x["fact"], "count": x["count"],
                   "previous": old.get("fact") if old else None,
                   "trend": None if not old else x["fact"] - old.get("fact", 0)}
            rows.append(row)
            d = {"volume": x["volume"], "registered": x["count"]}
            dn[norm(x["name"])] = d
            if x["oid"]: do[x["oid"]] = d
        base = mo.get(metric, {})
        mo[metric] = {**base, "name": base.get("name", title), "date": date_ru(end), "period": period_cumulative(end), "rows": rows}
        details[metric], oids[metric] = dn, do
        monthly[metric] = monthly_payload(prev, cur, end)
        facts[metric] = {"rows": len(rows), "numerator": sum(x["count"] for x in cur), "denominator": sum(x["volume"] for x in cur)}
    for name, data in [("mo-data.json", mo), ("mo-details.json", details), ("mo-detail-oids.json", oids), ("monthly-mo.json", monthly)]: save(app, name, data)
    return AdapterResult("core_monthly", ["egpu_attachment"], "PASS", ["mo-data.json","mo-details.json","mo-detail-oids.json","monthly-mo.json"], [source.name], facts, [], [])


def parse_hospital(path: Path) -> list[dict]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = _sheet(wb, ["Лист3"])
    out = []
    for r in ws.iter_rows(min_row=6, values_only=True):
        if len(r) < 6 or not r[1] or not r[2]: continue
        den, num = n(r[3]), n(r[4]) + n(r[5])
        out.append({"name": str(r[1]), "oid": str(r[2]), "fact": num / den * 100 if den else 0, "count": num, "volume": den})
    if not out: raise ValueError("Госпитализации: не найдено строк данных")
    return out


def adapt_hospital(app: Path, source: Path, end: date) -> AdapterResult:
    mo, details, oids, monthly = (load(app, x) for x in ["mo-data.json", "mo-details.json", "mo-detail-oids.json", "monthly-mo.json"])
    cur = parse_hospital(source); prev = previous_rows_from_dataset(mo.get("hospital", {})); rows=[]; dn={}; do={}
    for x in cur:
        old=prev.get(x["oid"]); rows.append({"name":x["name"],"oid":x["oid"],"fact":x["fact"],"count":x["count"],"previous":old.get("fact") if old else None,"trend":None if not old else x["fact"]-old.get("fact",0)})
        d={"volume":x["volume"],"registered":x["count"]}; dn[norm(x["name"])]=d; do[x["oid"]]=d
    mo["hospital"]={**mo.get("hospital",{}),"date":date_ru(end),"period":period_cumulative(end),"rows":rows}
    details["hospital"],oids["hospital"]=dn,do; monthly["hospital"]=monthly_payload(prev,cur,end)
    for name,data in [("mo-data.json",mo),("mo-details.json",details),("mo-detail-oids.json",oids),("monthly-mo.json",monthly)]:save(app,name,data)
    return AdapterResult("core_monthly",["hospital_cases"],"PASS",["mo-data.json","mo-details.json","mo-detail-oids.json","monthly-mo.json"],[source.name],{"rows":len(rows),"numerator":sum(x["count"] for x in cur),"denominator":sum(x["volume"] for x in cur)},[],[])


def parse_certificates(path: Path) -> list[dict]:
    wb=openpyxl.load_workbook(path,read_only=True,data_only=True); ws=wb.active; g=defaultdict(lambda:[0,0]); seen=set()
    for r in ws.iter_rows(values_only=True):
        if len(r)<4: continue
        name=str(r[0] or '').strip(); number=str(r[1] or '').strip(); state=str(r[3] or '').strip()
        if not name or not number or name.startswith(("Учреждение","Где в столбце")): continue
        # Some cumulative files can repeat header-like rows; only actual certificate rows matter.
        if number in seen: raise ValueError(f"Дубль свидетельства {number}")
        seen.add(number); g[name][0]+=1; g[name][1]+=int(state.casefold()=="зарегистрирован")
    out=[]
    for name,(den,num) in g.items(): out.append({"name":name,"fact":num/den*100 if den else 0,"count":num,"volume":den})
    if not out: raise ValueError("Свидетельства: не найдено строк данных")
    return out


def adapt_certificates(app: Path, source: Path, end: date, metric: str, family: str) -> AdapterResult:
    mo,details,monthly=(load(app,x) for x in ["mo-data.json","mo-details.json","monthly-mo.json"]); cur=parse_certificates(source); prev=previous_rows_from_dataset(mo.get(metric,{})); rows=[]; dn={}
    for x in cur:
        old=prev.get(norm(x["name"])); rows.append({"name":x["name"],"fact":x["fact"],"count":x["count"],"previous":old.get("fact") if old else None,"trend":None if not old else x["fact"]-old.get("fact",0)})
        dn[norm(x["name"]) ]={"volume":x["volume"],"registered":x["count"]}
    mo[metric]={**mo.get(metric,{}),"date":date_ru(end),"period":period_cumulative(end),"rows":rows}; details[metric]=dn; monthly[metric]=monthly_payload(prev,cur,end)
    for name,data in [("mo-data.json",mo),("mo-details.json",details),("monthly-mo.json",monthly)]:save(app,name,data)
    total=sum(x["volume"] for x in cur); num=sum(x["count"] for x in cur)
    return AdapterResult("core_monthly",[family],"PASS",["mo-data.json","mo-details.json","monthly-mo.json"],[source.name],{"rows":len(rows),"numerator":num,"denominator":total,"fact":num/total*100 if total else None},[],[])


def parse_max(path: Path, col: int) -> list[dict]:
    wb=openpyxl.load_workbook(path,read_only=True,data_only=True); ws=_sheet(wb,["Лист1"]); out=[]
    for r in ws.iter_rows(min_row=3,values_only=True):
        if len(r)>col and r[0]: out.append({"name":str(r[0]),"fact":n(r[col]),"count":n(r[col])})
    if not out: raise ValueError("ТМК_МАХ: не найдено строк данных")
    return out


def adapt_max(app: Path, source: Path, end: date) -> AdapterResult:
    operational,monthly=(load(app,x) for x in ["operational-mo.json","monthly-mo.json"]); facts={}
    for metric,col in [("tmkMaxCount",3),("elnMaxCount",4)]:
        cur=parse_max(source,col); prev=previous_rows_from_dataset(operational.get(metric,{})); rows=[]
        for x in cur:
            old=prev.get(norm(x["name"])); rows.append({"name":x["name"],"fact":x["fact"],"count":x["count"],"previous":old.get("fact") if old else None,"trend":None if not old else x["fact"]-old.get("fact",0)})
        operational[metric]={**operational.get(metric,{}),"date":date_ru(end),"period":period_cumulative(end),"rows":rows}; monthly[metric]=monthly_payload(prev,cur,end,"count")
        facts[metric]={"rows":len(rows),"total":sum(x["count"] for x in cur)}
    save(app,"operational-mo.json",operational);save(app,"monthly-mo.json",monthly)
    return AdapterResult("core_monthly",["max_tmk_eln"],"PASS",["operational-mo.json","monthly-mo.json"],[source.name],facts,[],[])


def parse_errors(path: Path) -> dict:
    """Parse the REMD rejection report without losing the source MO fields.

    Category aggregation remains identical to the legacy import: description
    (or message code when description is blank) + weighted ``Количество``.
    Organization attribution is independent from the dashboard MO registry: a
    source OID or a usable source MO name is enough to consider an error
    attributed. Registry matching is used only to choose an approved display
    name when possible.
    """
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    categories = Counter()
    organizations: dict[str, dict] = {}
    unassigned = Counter()
    source_rows = 0
    attributed_rows = 0

    for r in ws.iter_rows(min_row=7, values_only=True):
        if len(r) <= 9:
            continue
        count = n(r[9])
        # Count every actual error row. When both source MO identifiers are
        # absent, preserve it explicitly as "МО не определена" instead of
        # silently dropping it from the completeness check.
        if count <= 0:
            continue
        category = str(r[8] or r[7] or "Без описания").strip()
        oid = str(r[1] or "").strip()
        source_name = str(r[2] or "").strip()
        categories[category] += count
        source_rows += 1

        if oid or source_name:
            key = f"oid:{oid}" if oid else f"name:{norm(source_name)}"
            item = organizations.setdefault(key, {
                "key": key, "oid": oid or None, "sourceName": source_name or None,
                "count": 0, "rows": 0, "categories": Counter(),
            })
            item["count"] += count
            item["rows"] += 1
            item["categories"][category] += count
            attributed_rows += 1
        else:
            unassigned[category] += count

    if not categories:
        raise ValueError("Отказы РЭМД: не найдено категорий")
    return {
        "categories": categories, "organizations": organizations,
        "unassigned": unassigned, "sourceRows": source_rows,
        "attributedRows": attributed_rows,
    }


def adapt_errors(app: Path, source: Path, end: date) -> AdapterResult:
    parsed = parse_errors(source)
    counts: Counter = parsed["categories"]
    total = sum(counts.values())

    registry = load(app, "mo-registry.json")
    by_oid = {str(x.get("oid")): x for x in registry.get("organizations", []) if x.get("oid")}
    organizations = []
    registry_matched_errors = 0
    for raw in parsed["organizations"].values():
        reg = by_oid.get(str(raw.get("oid"))) if raw.get("oid") else None
        if reg:
            registry_matched_errors += raw["count"]
        display_name = (reg or {}).get("shortName") or (reg or {}).get("name") or raw.get("sourceName") or raw.get("oid") or "МО не определена"
        category_rows = [{"name": k, "count": v} for k, v in raw["categories"].most_common()]
        organizations.append({
            "key": raw["key"], "oid": raw.get("oid"), "name": display_name,
            "sourceName": raw.get("sourceName"), "count": raw["count"],
            "topCategories": category_rows[:3], "categories": category_rows,
        })
    organizations.sort(key=lambda x: (-x["count"], x["name"]))

    unassigned: Counter = parsed["unassigned"]
    unassigned_errors = sum(unassigned.values())
    attributed_errors = total - unassigned_errors
    coverage = attributed_errors / total * 100 if total else 100.0
    registry_coverage = registry_matched_errors / total * 100 if total else 100.0
    breakdown = {
        "status": "available", "sourcePeriod": period_cumulative(end),
        "totalErrors": total, "attributedErrors": attributed_errors,
        "unassignedErrors": unassigned_errors, "coveragePercent": coverage,
        "sourceRows": parsed["sourceRows"], "attributedRows": parsed["attributedRows"],
        "organizationCount": len(organizations),
        "registryMatchedErrors": registry_matched_errors,
        "registryCoveragePercent": registry_coverage,
        "organizations": organizations,
        "unassignedCategories": [{"name": k, "count": v} for k, v in unassigned.most_common()],
    }

    payload = load(app, "error-categories.json")
    payload.update({
        "total": total, "period": period_cumulative(end), "share": None,
        "shareDate": date_ru(end),
        "shareSource": "Доля не рассчитана: в выгрузке отказов отсутствует знаменатель всех обработанных запросов",
        "successfulRequests": None,
        "items": [{"name": k, "count": v} for k, v in counts.most_common()],
        "organizationBreakdown": breakdown,
    })
    save(app, "error-categories.json", payload)
    warnings = []
    if unassigned_errors:
        warnings.append(f"МО не определена для {unassigned_errors} ошибок ({100-coverage:.2f}%)")
    return AdapterResult(
        "errors", ["remd_errors"], "PASS", ["error-categories.json"], [source.name],
        {"errors": total, "categories": len(payload["items"]),
         "organizations": len(organizations), "attributedErrors": attributed_errors,
         "unassignedErrors": unassigned_errors, "coveragePercent": coverage},
        warnings, [],
    )


SPECIALTIES={"Акушер-гинеколог":"doctor500_obgyn","Врач общей практики":"doctor500_gp","Кардиолог":"doctor500_cardiologist","Онколог":"doctor500_oncologist","Офтальмолог":"doctor500_ophthalmologist","Педиатр":"doctor500_pediatrician","Стоматолог":"doctor500_dentist","Терапевт":"doctor500_therapist","Хирург":"doctor500_surgeon"}

def parse_physicians(path: Path, registry_path: Path) -> dict:
    wb=openpyxl.load_workbook(path,read_only=True,data_only=True); registry=json.loads(registry_path.read_text(encoding="utf-8"))["organizations"]; roids={str(x["oid"]) for x in registry}
    all_rows=[r for r in wb["Все врачи_Детализация по МО"].iter_rows(min_row=9,values_only=True) if r[0]=="Республика Татарстан" and r[1]]
    specialty_rows=[r for r in wb["Врачи по спец-тям_По МО"].iter_rows(min_row=9,values_only=True) if r[0]=="Республика Татарстан" and r[1] and r[4] in SPECIALTIES]
    unmatched=({str(r[1]) for r in all_rows}|{str(r[1]) for r in specialty_rows})-roids
    if unmatched: raise ValueError(f"Врачи: неизвестные OID {sorted(unmatched)[:10]}")
    for r in specialty_rows:
        den,signed,under,between,over=map(n,r[5:10])
        if signed!=under+between+over or signed>den: raise ValueError(f"Врачи: категории не сходятся {r[1]} {r[4]}")
        if len(r)>13 and r[13] is not None and not math.isclose(float(r[13]),over/den if den else 0,abs_tol=0.0002): raise ValueError(f"Врачи: доля источника не сходится {r[1]} {r[4]}")
    def mk(rows,numi,deni):
        return [{"name":str(r[2]),"oid":str(r[1]),"fact":n(r[numi])/n(r[deni])*100 if n(r[deni]) else 0,"count":n(r[numi]),"volume":n(r[deni])} for r in rows]
    out={"doctorsAll":mk(all_rows,6,4),"doctorsLevel3":mk([r for r in all_rows if r[3]=="III уровень"],6,4)}
    for sp,key in SPECIALTIES.items(): out[key]=mk([r for r in specialty_rows if r[4]==sp],9,5)
    if "Врачи по спец-тям_По субъекту" in wb.sheetnames:
        subject=wb["Врачи по спец-тям_По субъекту"]
        subject_values={str(r[1]):(n(r[2]),n(r[6])) for r in subject.iter_rows(min_row=10,values_only=True) if r[0]=="Республика Татарстан" and r[1] in SPECIALTIES}
        for sp,key in SPECIALTIES.items():
            if sp not in subject_values: continue
            expected=subject_values[sp]; actual=(sum(x["volume"] for x in out[key]),sum(x["count"] for x in out[key]))
            if expected!=actual: raise ValueError(f"Врачи: региональная сверка не сходится {sp}: {expected} != {actual}")
    return out


def adapt_physicians(app: Path, source: Path, end: date, registry_path: Path) -> AdapterResult:
    phys,monthly=(load(app,x) for x in ["physician-metrics.json","monthly-mo.json"]); current=parse_physicians(source,registry_path); facts={}
    for metric,cur in current.items():
        old_ds=phys.get("datasets",{}).get(metric,{}); prev=previous_rows_from_dataset(old_ds); rows=[]
        for x in cur:
            old=prev.get(x["oid"]); warning="Справочно: в МО только 1–2 врача этой специальности; в заслушивании не оценивается." if metric.startswith("doctor500_") and x["volume"]<3 else None
            rows.append({**x,"previous":old.get("fact") if old else None,"trend":None if not old else x["fact"]-old.get("fact",0),"sourceWarning":warning})
        num=sum(x["count"] for x in cur); den=sum(x["volume"] for x in cur)
        ds={**old_ds,"date":date_ru(end),"period":month_label(end),"periodType":"month","rows":rows,"summary":{"numerator":num,"denominator":den,"fact":num/den*100 if den else 0}}
        phys.setdefault("datasets",{})[metric]=ds; monthly[metric]=monthly_payload(prev,cur,end)
        monthly[metric]["previousLabel"]=previous_month_label(end);monthly[metric]["currentLabel"]=month_label(end).capitalize()
        facts[metric]=ds["summary"]
    phys["source"]=source.name;phys["formed"]=date_ru(end);phys["period"]=month_label(end);phys["quality"]={"allMoRows":len(current["doctorsAll"]),"specialtyRows":sum(len(current[k]) for k in SPECIALTIES.values()),"unmatchedOids":0,"categoryErrors":0}
    save(app,"physician-metrics.json",phys);save(app,"monthly-mo.json",monthly)
    return AdapterResult("physician_import",["physicians"],"PASS",["physician-metrics.json","monthly-mo.json"],[source.name],facts,[],[])


def parse_remd(path: Path) -> dict:
    wb=openpyxl.load_workbook(path,read_only=True,data_only=True); ws=_sheet(wb,["Отчет РЭМД по МО"]); out={}
    for r in ws.iter_rows(min_row=8,values_only=True):
        if len(r)>107 and r[2]: out[str(r[2])]={"name":str(r[1]),"s122":n(r[80]),"s228":n(r[107])}
    if not out: raise ValueError("РЭМД 122/228: не найдено строк данных")
    return out


def parse_foms(path: Path) -> dict:
    wb=openpyxl.load_workbook(path,read_only=True,data_only=True); ws=wb.active; out={}
    for r in ws.iter_rows(min_row=5,values_only=True):
        if len(r)>3 and r[1] and r[2]: out[str(r[2])]={"name":str(r[1]),"den":n(r[3])}
    if not out: raise ValueError("ФОМС профилактика: не найдено строк данных")
    return out


def adapt_preventive(app: Path, remd: Path, foms_path: Path, end: date, registry_path: Path) -> AdapterResult:
    rr,ff=parse_remd(remd),parse_foms(foms_path); mo,details,oids,monthly=(load(app,x) for x in ["mo-data.json","mo-details.json","mo-detail-oids.json","monthly-mo.json"]); prev=previous_rows_from_dataset(mo.get("semd228",{})); rows=[]; audit_rows=[]; dn={};do={};excluded=[]
    child_oids={str(o["oid"]) for o in json.loads(registry_path.read_text(encoding="utf-8"))["organizations"] if re.search(r"детск|\b(?:адрб|дркб|ндрб|кдмц)\b",(str(o.get("type",""))+" "+str(o.get("name",""))).casefold())}
    for oid,v in ff.items():
        rv=rr.get(oid)
        if not rv: excluded.append({"oid":oid,"name":v["name"],"denominator":v["den"]});continue
        num=max(rv["s122"],rv["s228"]); den=v["den"]; fact=num/den*100 if den else None; old=prev.get(oid); oldfact=old.get("fact") if old else None
        selected="122" if rv["s122"]>=rv["s228"] else "228"; audit_rows.append({"name":v["name"],"oid":oid,"child":oid in child_oids,"semd122":rv["s122"],"semd228":rv["s228"],"selected":num,"selectedType":selected,"foms":den,"share":fact,"oldShare":oldfact,"change":None if oldfact is None or fact is None else fact-oldfact,"issues":[] if fact is None or fact<=100 else ["Значение выше 100%"]})
        row={"name":v["name"],"oid":oid,"fact":fact or 0,"count":num,"previous":oldfact,"trend":None if oldfact is None or fact is None else fact-oldfact};rows.append(row);d={"volume":den,"registered":num};dn[norm(v["name"])]=d;do[oid]=d
    num=sum(r["selected"] for r in audit_rows); den=sum(r["foms"] for r in audit_rows); share=num/den*100 if den else None
    audit={"summary":{"status":"ready","year":end.year,"formula":"MAX(СЭМД 122; СЭМД 228) по каждой МО" if end.year<=2026 else "СЭМД 228","period122":period_cumulative(end),"period228":period_cumulative(end),"source122":remd.name,"source228":remd.name,"sourceDenominator":foms_path.name,"organizations":len(rows),"numerator":num,"denominator":den,"share":share,"selected122":sum(r["selectedType"]=="122" for r in audit_rows),"selected228":sum(r["selectedType"]=="228" for r in audit_rows),"selectedEqual":sum(r["semd122"]==r["semd228"] for r in audit_rows),"over100":sum((r["share"] or 0)>100 for r in audit_rows),"missing":len(excluded),"excluded":excluded,"note":"Включены взрослые и детские МО из ФОМС; строки без соответствия РЭМД остаются в аудите и не оцениваются."},"rows":audit_rows}
    mo["semd228"]={**mo.get("semd228",{}),"date":date_ru(end),"period":period_cumulative(end),"rows":rows};details["semd228"]=dn;oids["semd228"]=do
    cur=[{"name":r["name"],"oid":r["oid"],"fact":r["share"] or 0,"count":r["selected"],"volume":r["foms"]} for r in audit_rows];monthly["semd228"]=monthly_payload(prev,cur,end)
    for name,data in [("preventive-semd-audit.json",audit),("mo-data.json",mo),("mo-details.json",details),("mo-detail-oids.json",oids),("monthly-mo.json",monthly)]:save(app,name,data)
    return AdapterResult("preventive_pair",["preventive_remd","preventive_foms"],"PASS",["preventive-semd-audit.json","mo-data.json","mo-details.json","mo-detail-oids.json","monthly-mo.json"],[remd.name,foms_path.name],{"organizations":len(rows),"numerator":num,"denominator":den,"share":share,"excluded":len(excluded)},["Есть строки ФОМС без РЭМД; сохранены в audit" ] if excluded else [],[])


def extract_waybill(path: Path, period: str) -> dict:
    wb=openpyxl.load_workbook(path,read_only=True,data_only=True); ws=_sheet(wb,["Лист1","Статистика"]); start=14 if ws.title=="Лист1" else 15; rows=[]
    for v in ws.iter_rows(min_row=start,values_only=True):
        if len(v)<13 or not isinstance(v[0],(int,float)) or not v[1]:continue
        vehicles=n(v[2]);moved=n(v[5]);rows.append({"sourceNumber":n(v[0]),"name":str(v[1]).strip(),"vehicles":vehicles,"ambulanceVehicles":n(v[3]),"otherVehicles":n(v[4]),"moved":moved,"movementShare":moved/vehicles*100 if vehicles else None,"drivers":n(v[6]),"mechanics":n(v[7]),"medics":n(v[8]),"waybills":n(v[9]),"ambulanceWaybills":n(v[10]),"otherWaybills":n(v[11]),"driversWithWaybills":n(v[12])})
    if not rows:raise ValueError("ЭЛП: не найдено строк детализации")
    vehicles=sum(r["vehicles"] for r in rows); moved=sum(r["moved"] for r in rows)
    detail={"organizations":len(rows),"vehicles":vehicles,"vehiclesWithMovement":moved,"movementShare":moved/vehicles*100 if vehicles else None,"waybills":sum(r["waybills"] for r in rows),"driversWithWaybills":sum(r["driversWithWaybills"] for r in rows),"organizationsWithMovement":sum(r["vehicles"]>0 and r["moved"]>0 for r in rows),"zeroMovementOrganizations":sum(r["vehicles"]>0 and r["moved"]==0 for r in rows),"zeroVehicleOrganizations":sum(r["vehicles"]==0 for r in rows)}
    return {"source":path.name,"period":period,"sourceHeading":str(ws["B2"].value or ""),"systemSummary":{},"detail":detail,"rows":rows}


def adapt_waybill(app: Path, source: Path, end: date) -> AdapterResult:
    payload=load(app,"electronic-waybill-weekly.json"); period=f"до {date_ru(end)}"; current=extract_waybill(source,period); previous=payload.get("current") or payload.get("previous")
    out={"previous":previous,"current":current,"comparisonRule":payload.get("comparisonRule","Недельная динамика и рейтинг рассчитаны по сумме строк детализации по организациям."),"periodCorrection":payload.get("periodCorrection")}
    save(app,"electronic-waybill-weekly.json",out)
    return AdapterResult("waybill",["electronic_waybill"],"PASS",["electronic-waybill-weekly.json"],[source.name],current["detail"],[],[])



def oid_list(v) -> list[str]:
    if not v or str(v).strip().casefold() == "нет":
        return []
    return re.findall(r"\d+(?:\.\d+)+", str(v))


def _aggregate_unit_metric(app: Path, metric: str, units_payload: dict, end: date, period: str, subunit_mode: bool) -> None:
    mo, details, oids = (load(app, x) for x in ["mo-data.json", "mo-details.json", "mo-detail-oids.json"])
    prev = previous_rows_from_dataset(mo.get(metric, {}))
    grouped = defaultdict(lambda: {"name": "", "volume": 0, "registered": 0})
    for row in units_payload["rows"]:
        key = str(row.get("moOid") or norm(row.get("mo")))
        g = grouped[key]; g["name"] = row["mo"]
        if subunit_mode:
            g["volume"] += n(row.get("plannedSubunits")); g["registered"] += n(row.get("registeredSubunits"))
        else:
            g["volume"] += 1; g["registered"] += int(bool(row.get("registered")))
    rows=[]; dn={}; do={}
    for oid,g in grouped.items():
        fact=g["registered"]/g["volume"]*100 if g["volume"] else 0
        old=prev.get(oid) or prev.get(norm(g["name"])); pv=old.get("fact") if old else None
        rows.append({"name":g["name"],"oid":oid if "." in oid and oid[0].isdigit() else "","fact":fact,"count":g["registered"],"previous":pv,"trend":None if pv is None else fact-pv})
        d={"volume":g["volume"],"registered":g["registered"]}; dn[norm(g["name"])]=d
        if "." in oid and oid[0].isdigit(): do[oid]=d
    base=mo.get(metric,{})
    mo[metric]={**base,"name":base.get("name",units_payload["name"]),"date":date_ru(end),"period":period,"rows":rows}
    details[metric]=dn;oids[metric]=do
    save(app,"mo-data.json",mo);save(app,"mo-details.json",details);save(app,"mo-detail-oids.json",oids)


def adapt_tvsp_subunits(app: Path, source: Path, end: date, metric: str, family: str, title: str, entity: str) -> AdapterResult:
    wb=openpyxl.load_workbook(source,read_only=True,data_only=True)
    ws=_sheet(wb,["Детализация по СП"]); old_units=load(app,"unit-data.json").get(metric,{})
    old_counts={(str(r.get("moOid","")),str(r.get("buildingIds",r.get("unitOid","")))):n(r.get("count")) for r in old_units.get("rows",[])}
    rows=[]
    for r in ws.iter_rows(min_row=7,values_only=True):
        if len(r)<6 or str(r[0] or "").strip()!="Республика Татарстан" or not r[1]: continue
        planned=sorted(set(oid_list(r[4]))); passed=sorted(set(oid_list(r[5]))); registered=sorted(set(planned)&set(passed))
        if not planned: continue
        bid=str(r[3] or ""); oid=str(r[2] or "")
        rows.append({"mo":str(r[1]),"moOid":oid,"unit":f"Здание {bid}","unitOid":", ".join(planned),"buildingIds":bid,"registered":bool(registered),"partial":0<len(registered)<len(planned),"count":old_counts.get((oid,bid),0),"plannedSubunits":len(planned),"registeredSubunits":len(registered)})
    if not rows: raise ValueError(f"{family}: не найдено строк детализации")
    plan=len(rows); fact=sum(bool(r["registered"]) for r in rows)
    if "Сводный" in wb.sheetnames:
        vals=next(wb["Сводный"].iter_rows(min_row=7,max_row=7,values_only=True),None)
        if vals and len(vals)>3 and n(vals[2])>0: plan=n(vals[2]);fact=n(vals[3])
    units=load(app,"unit-data.json");units[metric]={"name":title,"entity":entity,"plan":plan,"fact":fact,"date":date_ru(end),"rows":rows};save(app,"unit-data.json",units)
    _aggregate_unit_metric(app,metric,units[metric],end,f"январь–{month_label(end)}",True)
    return AdapterResult("tvsp",[family],"PASS",["unit-data.json","mo-data.json","mo-details.json","mo-detail-oids.json"],[source.name],{"objects":len(rows),"plan":plan,"fact":fact,"subunits":sum(r["plannedSubunits"] for r in rows),"registeredSubunits":sum(r["registeredSubunits"] for r in rows)},[],[])


def adapt_tvsp_buildings(app: Path, source: Path, end: date, metric: str, family: str, title: str, entity: str, start_row: int) -> AdapterResult:
    wb=openpyxl.load_workbook(source,read_only=True,data_only=True);ws=_sheet(wb,["Факт передачи"])
    old_units=load(app,"unit-data.json").get(metric,{})
    old_counts={(str(r.get("moOid","")),str(r.get("buildingIds",r.get("unitOid","")))):n(r.get("count")) for r in old_units.get("rows",[])}
    seen={}
    for r in ws.iter_rows(min_row=start_row,values_only=True):
        if len(r)<7 or str(r[1] or "").strip()!="Республика Татарстан" or not r[2]: continue
        oid,bid=str(r[3] or ""),str(r[4] or "");k=(oid,bid)
        seen[k]={"mo":str(r[2]),"moOid":oid,"unit":str(r[5] or f"Здание {bid}"),"unitOid":bid,"buildingIds":bid,"registered":str(r[6] or "").strip().casefold()=="да","count":old_counts.get(k,0)}
    rows=list(seen.values())
    if not rows: raise ValueError(f"{family}: не найдено объектных строк")
    units=load(app,"unit-data.json");units[metric]={"name":title,"entity":entity,"plan":len(rows),"fact":sum(r["registered"] for r in rows),"date":date_ru(end),"rows":rows};save(app,"unit-data.json",units)
    _aggregate_unit_metric(app,metric,units[metric],end,period_cumulative(end),False)
    return AdapterResult("tvsp",[family],"PASS",["unit-data.json","mo-data.json","mo-details.json","mo-detail-oids.json"],[source.name],{"objects":len(rows),"fact":units[metric]["fact"]},[],[])


def _elmk_counts(source: Path) -> dict[str,int]:
    wbv=openpyxl.load_workbook(source,read_only=True,data_only=True);ws=wbv["Отчет РЭМД по МО"]
    cols=[]
    try:
        wbf=openpyxl.load_workbook(source,read_only=True,data_only=False);h=wbf["Отчет РЭМД по МО"]
        names=list(h.iter_rows(min_row=5,max_row=5,values_only=True))[0]; fmts=list(h.iter_rows(min_row=6,max_row=6,values_only=True))[0]; last=""
        for idx,(a,b) in enumerate(zip(names,fmts),start=1):
            if a: last=str(a)
            text=(last+" "+str(b or "")).casefold()
            if ("элмк" in text and "подсистем" in text) or ("медицинское заключение" in text and "осмотр" in text): cols.append(idx-1)
    except Exception: pass
    if not cols: cols=[125]
    out=defaultdict(int)
    for r in ws.iter_rows(min_row=8,values_only=True):
        if len(r)>2 and r[2]: out[str(r[2])]+=sum(n(r[c]) for c in cols if c<len(r))
    if not out: raise ValueError("ЭЛМК: не найдено строк по МО")
    return dict(out)


def adapt_presence(app: Path, source: Path, end: date, family: str) -> AdapterResult:
    status=load(app,"organization-status.json")
    if family=="tmk_remd":
        wb=openpyxl.load_workbook(source,read_only=True,data_only=True);ws=_sheet(wb,["Детализированный отчет"])
        counts={str(r[3]):n(r[4]) for r in ws.iter_rows(min_row=7,values_only=True) if len(r)>4 and str(r[1] or "").strip()=="Республика Татарстан" and r[3]}
        key="tmkRemd"
    else:
        counts=_elmk_counts(source);key="elmk"
    rows=[]
    for old in status[key]["rows"]:
        count=counts.get(str(old.get("oid","")),0);fact=100 if count>0 else 0;prev=old.get("fact")
        rows.append({**old,"count":count,"fact":fact,"previous":prev,"trend":None if prev is None else fact-prev})
    positive=sum(r["fact"]>0 for r in rows); total=len(rows)
    note=(f"Плановый перечень — {total} МО; {positive} МО передают протоколы ТМК в РЭМД." if family=="tmk_remd" else f"Плановый перечень — {total} МО. На {date_ru(end)} передача подтверждена у {positive} МО; ноль не трактуется как нарушение без проверки лицензии.")
    status[key].update({"date":date_ru(end),"period":period_cumulative(end),"note":note,"rows":rows});save(app,"organization-status.json",status)
    return AdapterResult("status_detail",[family],"PASS",["organization-status.json"],[source.name],{"planOrganizations":total,"transmitting":positive},[],[])


def adapt_short_input(app: Path, source: Path, end: date) -> AdapterResult:
    wb=openpyxl.load_workbook(source,read_only=True,data_only=True);ws=_sheet(wb,["Краткий ввод"]);raw=[]
    for r in ws.iter_rows(min_row=7,values_only=True):
        if len(r)<7 or not r[0] or str(r[0]).strip().casefold().startswith("итого"): continue
        raw.append((str(r[0]).strip(),str(r[1] or "").strip(),n(r[3])+n(r[6]),n(r[4])+n(r[5])))
    if not raw: raise ValueError("Краткий ввод: не найдено строк")
    op=load(app,"operational-mo.json");facts={}
    for key,title in [("shortInput","Количество случаев краткого ввода — всего"),("shortInputAmb","Количество случаев краткого ввода — амбулаторно"),("shortInputHosp","Количество случаев краткого ввода — стационар")]:
        prev=previous_rows_from_dataset(op.get(key,{}));rows=[]
        for name,oid,amb,hosp in raw:
            fact=amb+hosp if key=="shortInput" else amb if key=="shortInputAmb" else hosp;old=prev.get(oid) or prev.get(norm(name));pv=old.get("fact") if old else None
            row={"name":name,"oid":oid,"fact":fact,"count":fact,"previous":pv,"trend":None if pv is None else fact-pv}
            if pv is not None and fact<pv: row["sourceWarning"]="Накопительное значение уменьшилось; корректировка источника требует уточнения."
            rows.append(row)
        op[key]={**op.get(key,{}),"name":title,"date":date_ru(end),"period":period_cumulative(end),"mode":"count","direction":"lower","note":"Справочный накопительный показатель без норматива: не влияет на рейтинг и приоритет заслушивания. Уменьшение накопительного значения отмечается как риск качества источника.","rows":rows};facts[key]=sum(r["fact"] for r in rows)
    save(app,"operational-mo.json",op);return AdapterResult("operational",["short_input"],"PASS",["operational-mo.json"],[source.name],facts,[],[])


def adapt_fap(app: Path, source: Path, end: date) -> AdapterResult:
    wb=openpyxl.load_workbook(source,read_only=True,data_only=True);ws=_sheet(wb,["Лист1"]);grouped=defaultdict(lambda:{"count":0,"units":0,"zero":0})
    for r in ws.iter_rows(min_row=5,values_only=True):
        if len(r)<4 or not r[0]:continue
        g=grouped[str(r[0])];v=n(r[3]);g["count"]+=v;g["units"]+=1;g["zero"]+=int(v==0)
    if not grouped: raise ValueError("ФАП/ФП: не найдено строк")
    op=load(app,"operational-mo.json");prev=previous_rows_from_dataset(op.get("fapSemdCount",{}));rows=[]
    for name,v in sorted(grouped.items(),key=lambda x:norm(x[0])):
        old=prev.get(norm(name));pv=old.get("fact") if old else None;row={"name":name,"fact":v["count"],"count":v["count"],"previous":pv,"trend":None if pv is None else v["count"]-pv,"units":v["units"],"zeroUnits":v["zero"]}
        if v["zero"]:row["sourceWarning"]=f'{v["zero"]} ФАП/ФП с нулевым результатом из {v["units"]}'
        rows.append(row)
    op["fapSemdCount"]={**op.get("fapSemdCount",{}),"name":"Количество зарегистрированных СЭМД по ФАП и ФП","date":date_ru(end),"period":period_cumulative(end),"mode":"count","note":"Лист 1 содержит полный перечень ФАП/ФП; нулевые подразделения сохранены и показаны отдельно.","rows":rows};save(app,"operational-mo.json",op)
    return AdapterResult("federal",["fap_fp"],"PASS",["operational-mo.json"],[source.name],{"organizations":len(rows),"units":sum(v["units"] for v in grouped.values()),"zeroUnits":sum(v["zero"] for v in grouped.values()),"documents":sum(v["count"] for v in grouped.values())},[],[])


def _asu_rows(path: Path):
    if path.suffix.casefold()==".xlsx":
        wb=openpyxl.load_workbook(path,read_only=False,data_only=True);ws=wb.active
        for row in ws.iter_rows(min_row=9):
            vals=[c.value for c in row];yield vals,bool(row[0].font.bold)
        return
    try:
        import xlrd  # type: ignore
        book=xlrd.open_workbook(str(path),formatting_info=True);sh=book.sheet_by_index(0)
        for i in range(8,sh.nrows):
            vals=[sh.cell_value(i,c) for c in range(sh.ncols)];cell=sh.cell(i,0);bold=bool(book.font_list[book.xf_list[cell.xf_index].font_index].bold);yield vals,bold
        return
    except ImportError:
        soffice=shutil.which("soffice") or shutil.which("libreoffice")
        if not soffice:
            raise RuntimeError("Для legacy .xls АСУ СМП нужен xlrd либо LibreOffice/soffice для безопасного staging-конвертирования")
        with tempfile.TemporaryDirectory() as td:
            proc=subprocess.run([soffice,"--headless","--convert-to","xlsx","--outdir",td,str(path)],text=True,capture_output=True)
            converted=Path(td)/(path.stem+".xlsx")
            if proc.returncode or not converted.exists():
                raise RuntimeError(f"Не удалось прочитать legacy .xls АСУ СМП: {proc.stderr[-500:]}")
            wb=openpyxl.load_workbook(converted,read_only=False,data_only=True);ws=wb.active
            for row in ws.iter_rows(min_row=9):
                vals=[c.value for c in row];yield vals,bool(row[0].font.bold)
        return


def adapt_asu_smp(app: Path, source: Path, end: date) -> AdapterResult:
    mo,details=(load(app,x) for x in ["mo-data.json","mo-details.json"]);prev=previous_rows_from_dataset(mo.get("smp",{}));rows=[]
    for r,bold in _asu_rows(source):
        if len(r)<=10 or not bold or not str(r[0] or "").strip():continue
        name=str(r[0]).strip();vol=n(r[1]);reg=n(r[10]);fact=reg/vol*100 if vol else 0;old=prev.get(norm(name));pv=old.get("fact") if old else None
        rows.append({"name":name,"fact":fact,"count":reg,"volume":vol,"registered":reg,"previous":pv,"trend":None if pv is None else fact-pv})
    if not rows:raise ValueError("АСУ СМП: не найдено итоговых строк организаций")
    mo["smp"]={**mo.get("smp",{}),"date":date_ru(end),"period":period_cumulative(end),"note":"Числитель — статус «Принято» АСУ СМП, принимаемый как регистрация в РЭМД; знаменатель — количество карт вызова АСУ СМП за тот же период.","rows":rows};details["smp"]={norm(r["name"]):{"volume":r["volume"],"registered":r["registered"]} for r in rows};save(app,"mo-data.json",mo);save(app,"mo-details.json",details)
    return AdapterResult("federal",["asu_smp"],"PASS",["mo-data.json","mo-details.json"],[source.name],{"organizations":len(rows),"volume":sum(r["volume"] for r in rows),"registered":sum(r["registered"] for r in rows)},[],[])

SUPPORTED_FAMILIES={
    "egpu_attachment","hospital_cases","preventive_remd","preventive_foms","birth_certificates","death_certificates","max_tmk_eln","physicians","remd_errors","electronic_waybill",
    "tvsp_ambulatory","tvsp_stationary","tvsp_laboratory","tvsp_diagnostic","smp_tvsp","tmk_remd","elmk","short_input","fap_fp","asu_smp"
}

def run_family(app:Path,family:str,source:Path,end:date,root:Path)->AdapterResult:
    if family=="egpu_attachment": return adapt_egpu(app,source,end)
    if family=="hospital_cases": return adapt_hospital(app,source,end)
    if family=="birth_certificates": return adapt_certificates(app,source,end,"birth",family)
    if family=="death_certificates": return adapt_certificates(app,source,end,"death",family)
    if family=="max_tmk_eln": return adapt_max(app,source,end)
    if family=="physicians": return adapt_physicians(app,source,end,root/"app/mo-registry.json")
    if family=="remd_errors": return adapt_errors(app,source,end)
    if family=="electronic_waybill": return adapt_waybill(app,source,end)
    if family=="tvsp_ambulatory": return adapt_tvsp_subunits(app,source,end,"tvspAmbulatory",family,"Амбулаторные ТВСП, передающие эпикриз/талон и/или протокол консультации","объект контроля с ТВСП")
    if family=="tvsp_stationary": return adapt_tvsp_subunits(app,source,end,"tvspStationary",family,"ТВСП, передающие выписные эпикризы","объект контроля с ТВСП")
    if family=="tvsp_laboratory": return adapt_tvsp_subunits(app,source,end,"tvspLaboratory",family,"КДЛ, передающие протокол лабораторного исследования","КДЛ / лаборатория")
    if family=="tvsp_diagnostic": return adapt_tvsp_buildings(app,source,end,"tvspDiagnostic",family,"ТВСП, передающие протоколы диагностических исследований","объект контроля",8)
    if family=="smp_tvsp": return adapt_tvsp_buildings(app,source,end,"smpFederal",family,"Станции и подстанции СМП, передающие карты вызова","станция / подстанция СМП",7)
    if family in {"tmk_remd","elmk"}: return adapt_presence(app,source,end,family)
    if family=="short_input": return adapt_short_input(app,source,end)
    if family=="fap_fp": return adapt_fap(app,source,end)
    if family=="asu_smp": return adapt_asu_smp(app,source,end)
    raise KeyError(family)
