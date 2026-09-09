#!/usr/bin/env python3
from pathlib import Path

page = Path("app/page.tsx")
s = page.read_text(encoding="utf-8")

button_hook = 'onClick={() => setExtendedStatusFilter("exceptContract")}'
if button_hook not in s:
    all_button = '''                    <button
                      className={extendedStatusFilter === "all" ? "active" : ""}
                      onClick={() => setExtendedStatusFilter("all")}
                    >
                      Все
                    </button>
'''
    except_button = '''                    <button
                      className={
                        extendedStatusFilter === "exceptContract" ? "active" : ""
                      }
                      onClick={() => setExtendedStatusFilter("exceptContract")}
                    >
                      Все, кроме «В контракте»
                    </button>
'''
    if all_button not in s:
        raise RuntimeError("extended summary status group: anchor button not found")
    s = s.replace(all_button, all_button + except_button, 1)

if button_hook not in s:
    raise RuntimeError("extended summary status group: except-contract button was not inserted")

page.write_text(s, encoding="utf-8")
print("Visible extended-summary except-contract button is present")
