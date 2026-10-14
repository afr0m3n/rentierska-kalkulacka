# Audit původní aplikace

Audit vychází z úplného průchodu `legacy.html` (855 řádků) a z nezávislé revize datového toku, modelu, UI, ukládání a PDF exportu. Stav platí k 14. 10. 2026.

Závažnost: **kritická** = může vytvořit zásadně chybný finanční výsledek; **vysoká** = může uživatele významně uvést v omyl; **střední** = omezuje přesnost či spolehlivost; **nízká** = technický dluh nebo menší UX problém.

| ID | Závažnost | Nález | Stav po 1. etapě |
| --- | --- | --- | --- |
| A-01 | kritická | Neplatné věky a období se tiše opravovaly (např. konec renty na jeden rok) nebo vytvářely prázdné/absurdní simulace. | **Opraveno.** Centrální validace blokuje výsledek a označí konkrétní vstupy. |
| A-02 | kritická | Prázdné, nečíselné a záporné hodnoty se přes `parseFloat(...) || 0` měnily na platnou nulu. | **Opraveno.** `NaN`, záporné částky, desetinné věky a hodnoty mimo rozsah jsou neplatné. |
| A-03 | kritická | DPS šlo nastavit před 60. rokem; aplikace jen ukázala varování a dál počítala. | **Opraveno pro standardní výplatu.** Věk pod 60 let blokuje model. Smluvní spořicí dobu aplikace stále nezná (A-16). |
| A-04 | kritická | DPS po konci zadané doby dál čerpalo zůstatek a mimořádně dorovnávalo rentu. | **Opraveno.** DPS se čerpá pouze uvnitř pevného intervalu a nikdy nedorovnává mimo plán. |
| A-05 | vysoká | Použitý anuitní vzorec předpokládal výběr na konci období, simulace ale vybírala na začátku měsíce. | **Opraveno.** Použita anuita-due odpovídající pořadí cash flow; kryto numerickým testem. |
| A-06 | vysoká | Jednorázový vklad v minulém roce se bez upozornění přesunul do aktuálního měsíce. | **Opraveno.** Minulý vklad je neplatný; již investovaná částka patří do dnešní hodnoty portfolia. |
| A-07 | vysoká | Chyběla dnešní hodnota investičního portfolia, přestože DPS dnešní zůstatek mělo. | **Opraveno.** Přidáno pole „Dnešní hodnota“. |
| A-08 | vysoká | Souhrn sčítal „kapitál na startu renty“ osob i při různých letech startu. | **Opraveno.** Součet se zobrazí jen pro shodný měsíc startu; jinak je výslovně nedostupný. |
| A-09 | vysoká | Automatické ukládání jmen a finančních údajů do `localStorage` probíhalo bez volby uživatele. | **Opraveno.** Výchozí stav nic neukládá; uložení je opt-in a vypnutí uložená data smaže. |
| A-10 | vysoká | Státní příspěvek DPS pokračoval i po modelovaném přiznání starobního důchodu. | **Opraveno v rámci dostupných dat.** Od měsíce státního důchodu se příspěvek nepočítá. |
| A-11 | střední | Výnos „p.a.“ nebyl matematicky jednoznačný. | **Zdokumentováno.** Jde o nominální sazbu dělenou 12, s cash flow na začátku měsíce. |
| A-12 | střední | Aktuální datum bylo skrytou globální závislostí, takže model nebyl deterministicky testovatelný. | **Opraveno.** Čisté funkce dostávají referenční měsíc explicitně. |
| A-13 | střední | Výpočet potřebné úložky a udržitelné renty neměl testované limity a používal jen 40 iterací. | **Opraveno.** Izolované řešiče, pevné limity a 60 iterací; referenční testy pro nulový výnos. |
| A-14 | střední | PDF blok vyšší než zbývající stránka mohl přetéct nebo být oříznut. | **Opraveno technicky.** Canvas bloku se dělí na bezeztrátové výřezy; plán stránkování má testy. Sémantické dělení tabulek zůstává k vylepšení. |
| A-15 | střední | Chart.js, html2canvas, jsPDF a font se načítaly z CDN; offline provoz a soukromí závisely na třetích stranách. | **Opraveno.** Všechny runtime závislosti a Montserrat jsou součástí Vite bundlu. |
| A-16 | vysoká | Nárok na dávku DPS závisí kromě věku také na spořicí době a typu/sjednání produktu; aplikace tato data nemá. | **Otevřeno a výslovně označeno.** Model kontroluje jen standardní minimální věk; poradce musí nárok ověřit. |
| A-17 | vysoká | Model DPS nerozlišuje standardní penzi, jednorázové vyrovnání a předdůchod; jejich podmínky se liší. | **Otevřeno.** Neimplementováno bez jasného produktového zadání. |
| A-18 | vysoká | Domácnost je součtem oddělených osob, nikoli modelem sdíleného kapitálu a společného čerpání. | **Otevřeno.** UI už nesčítá kapitál z různých dat, ale sdílené portfolio vyžaduje samostatný návrh. |
| A-19 | vysoká | Investice a DPS nemají nezávislý začátek/konec spoření; DPS před rentou nemá definované použití. | **Částečně ošetřeno.** Nejednoznačná konfigurace je nyní neplatná. Nezávislé fáze jsou v roadmapě. |
| A-20 | střední | Inflace, valorizace důchodu/renty, poplatky, daně a příspěvek zaměstnavatele nejsou modelovány. | **Otevřeno a viditelně uvedeno.** Bez schválených předpokladů nebyla pravidla domýšlena. |
| A-21 | střední | Státní příspěvek je globální přepínač, ačkoli individuální nárok může být odlišný. | **Částečně ošetřeno.** Popisek nyní výslovně předpokládá splnění nároku; per-person nastavení je v roadmapě. |
| A-22 | střední | U již probíhající renty se dnešní zůstatek vydával za historický kapitál na startu. | **Opraveno konzervativně.** Start renty v minulosti je bez historie neplatný. |
| A-23 | nízká | Kód, styly, model, persistence a export byly v jednom souboru bez automatických testů. | **Opraveno.** Vite + TypeScript moduly + Vitest; `legacy.html` zůstává jako referenční artefakt. |

## Legislativní podklady a hranice modelu

- Ministerstvo financí uvádí od 1. 7. 2024 státní příspěvek ve výši 20 % pro měsíční vklad 500–1 700 Kč, tedy nejvýše 340 Kč: [Změny státního příspěvku ve III. pilíři](https://mf.gov.cz/cs/ministerstvo/media/tiskove-zpravy/2024/zmeny-statniho-prispevku-ve-iii-piliri-56059).
- Ministerstvo financí zároveň uvádí, že od 1. 7. 2024 se státní příspěvek neposkytuje účastníkům s přiznaným starobním důchodem: [Základní informace k III. pilíři](https://mf.gov.cz/cs/financni-trh/soukrome-penzijni-systemy/iii-pilir-doplnkove-penzijni-sporeni-a-p/zakladni-informace).
- Aktuální § 20 zákona č. 427/2011 Sb. váže standardní nárok mimo jiné na věk 60 let a spořicí dobu; přechodná a zvláštní pravidla nelze odvodit jen z polí legacy aplikace: [zákon o doplňkovém penzijním spoření](https://www.zakonyprolidi.cz/cs/2011-427).

Kalkulačka proto není nástrojem pro právní posouzení nároku. Přepínač státního příspěvku znamená „zahrnout při předpokladu splnění podmínek“, ne automatické potvrzení nároku.

## Testovaná matematická pravidla

- hraniční hodnoty státního příspěvku 499 / 500 / 1 700 Kč a strop nad 1 700 Kč;
- zastavení státního příspěvku od modelovaného přiznání důchodu;
- přesná anuita DPS pro výběr na začátku měsíce;
- nulový výnos jako ručně ověřitelná reference;
- nominální sazba 12 % p.a. jako 1 % měsíčně;
- dnešní investiční zůstatek a budoucí jednorázový vklad;
- konec DPS po přesně zvoleném období bez pozdějšího dorovnání;
- numerické řešení potřebné úložky a udržitelné renty;
- neplatné věky, období, minulý jednorázový vklad a prázdný numerický vstup;
- rozdělení vysokého PDF bloku mezi stránky bez ztráty pixelů.
