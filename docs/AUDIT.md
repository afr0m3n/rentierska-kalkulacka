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

## Etapa 1.5 – opravy nezávislé revize

Tato část nahrazuje popis aktuální implementace u relevantních nálezů výše; původní tabulka zachovává historii první etapy.

| ID | Priorita / závažnost | Oprava a ověření |
| --- | --- | --- |
| B-01 | P1 / kritická | Potřebná úložka se zaokrouhluje nahoru, udržitelná renta dolů, navýšení nahoru. Řešiče po zaokrouhlení znovu simulují. Reference 1 000,25 Kč → úložka 1 001 Kč; 1 000,75 Kč → renta 1 000 Kč. |
| B-02 | P1 / kritická | Veřejná simulace i řešiče validují scénář. Neplatné vstupy či numericky nepřiměřený kapitál vyvolají chybu; UI odstraní předchozí výsledky a zakáže PDF. Nedostupná úložka/kapitál používají `null`, nikoli `NaN` nebo `Infinity`. |
| B-03 | P1 / vysoká | Narození má měsíc a rok, milníky nejsou fixované na leden. Důchod má nezávislý měsíc a rok. Referenční měsíc UI používá Europe/Prague; jádro má stále explicitní datum. |
| B-04 | P1 / vysoká | Migrace v2/v3 zachovává vstupy. Chybějící měsíce jsou `null`; odvozený rok důchodu odpovídá starému ročníku + zadanému věku, měsíc se nedoplňuje. Načtení existujícího úložiště prohlížeče nezapíná automatické ukládání. |
| B-05 | P2 / kritická | Plné výplaty DPS a důchodu jsou oddělené od pokrytí cíle. Každý měsíc obsahuje cílový příjem, skutečný příjem, použitou část DPS/důchodu, přebytek a schodek. Přebytek odchází mimo kapitál. Reference DPS 10 000 Kč / cíl 1 000 Kč → použito 1 000 Kč, přebytek 9 000 Kč. |
| B-06 | P2 / vysoká | Domácnost agreguje měsíce na společné ose. Roční graf dělí součet 12, včetně neaktivních měsíců. Kapitál různých startů se nesčítá. Po konci osobní modelace je kapitál mimo graf; konečný zůstatek zůstává v osobním výsledku. |
| B-07 | P3 / vysoká | PDF má vstupy každé osoby, narození, výnosy, přepínač a součet státní podpory, jednorázový vklad s termínem, oba počáteční zůstatky, všechny milníky i skutečné cash flow. Přiměřené tabulky se přesunou celé na další stránku. |
| B-08 | P3 / střední | Fáze se označují DPS/důchod jen při skutečně kladné výplatě. Nulové produkty nevyvolají falešný nástup příjmu. |
| B-09 | P3 / vysoká | Export používá synchronní zámek, po dobu práce zakáže ovládání a v `finally` vrací stav i view. Druhý export neproběhne. |
| B-10 | P3 / vysoká | Vizuální kontrola skutečného PDF odhalila snímání grafu uprostřed aktualizace. Export nyní zastaví animaci, dokončí `update('none')` a teprve potom pořídí obrázek. Barvy datasetů jsou explicitní od inicializace; automatické přebarvování je vypnuté. Pixelové E2E kontrolují přítomnost sloupců v UI i reportu. |

### Technické hranice a přesné významy

- Měsíční částky: 0–1 000 000 Kč; kapitál/vklad: 0–1 000 000 000 Kč; věky: celé 0–120 let; výnos: více než −100 %, nejvýše 30 % nominální p.a. Jde o rozsah aplikace, nikoli zákonná omezení. Modelovaný zůstatek nad 10^15 Kč selže explicitně kvůli spolehlivosti numeriky.
- Řešič udržitelné renty hledá do 1 000 000 Kč/měs.; hodnota na stropu je potvrzená udržitelnost do tohoto rozsahu, nikoli tvrzení o vyšším matematickém maximu. Řešič úložky vrací `null`, pokud cíl není dosažitelný úložkou v povoleném rozsahu nebo už není akumulační období.
- Numerická tolerance celkového schodku je 10^-6 Kč, nikoli tolerování chybějící koruny renty.
- Pro přiřazení příjmu na cíl se zachovává pořadí důchod → DPS → výběr investic. Jde o účetní přiřazení; neomezuje skutečně vyplacený důchod ani DPS. Přebytek se nikdy nepřenese do dalších měsíců.
- Před rentou nemá scénář aktivní cílový příjem. Důchod vyplacený během spoření je příjem mimo cíl a není reinvestován. Již probíhající renta zůstává nepodporovaná.
- Jednorázový vklad má stále jen rok: letošní rok znamená referenční měsíc, budoucí rok leden. UI i PDF to výslovně uvádějí; přesnější jednorázová časová osa je otevřená.
- Konec období není zahrnut. Graf po tomto měsíci nesleduje zůstatek osoby, ale osobní KPI/PDF jej uvádí. Nejde o vyčerpání, ztrátu ani právní vypořádání.
- DPS zůstává ilustrativní anuitní čerpání. Minimální věk 60 let je zachovaný filtr, ne potvrzení nároku; doba 1–60 let je technický rozsah, ne legislativní povolení všech těchto dob. Smluvní spořicí doba, předdůchod, daňové dopady a individuální nárok na podporu jsou otevřené (A-16/A-17/A-21). Etapa 1.5 nová legislativní pravidla nezavádí.
- PDF je stále rastrový report; čitelnost se kontroluje vykreslením skutečných stránek, text není garantovaně vyhledatelný. Sémantické PDF a opakované hlavičky při extrémně dlouhých blocích zůstávají v roadmapě.

### Otevřená rozhodnutí

Inflace a nominální/reálná renta, valorizace, čistý výnos po poplatcích/daních, produktový a smluvní nárok DPS, individuální státní podpora, nezávislé fáze spoření, sdílený kapitál a další osud kapitálu po osobním horizontu vyžadují specifikaci. Souhrnné úložky a renty jsou výslovně součty osobních plánů v jejich vlastních obdobích, nikoli optimalizací společného portfolia.

### Ověření etapy 1.5 (14. 10. 2026)

- `npm ci`, `npm test` (48 testů), `npm run build` a `npm run test:e2e` (10 testů) úspěšné na Node.js 24.21.0.
- E2E běží nad produkčním `dist/` s pevným referenčním datem, desktopovým a mobilním viewportem. Kontroluje i viditelné sloupce uvnitř canvasu a nulový horizontální přesah stránky.
- Skutečný report s počáteční investicí 123 456 Kč a jednorázovým vkladem 654 321 Kč v roce 2030 byl stažen na desktopu i mobilu. Všechny tři stránky byly otevřeny/renderovány a ručně vizuálně zkontrolovány: vstupy, výsledky i oba grafy jsou čitelné; tabulky se nerozdělují uprostřed běžného bloku.
- PDF, screenshoty a traces jsou pouze lokální syntetické testovací artefakty v ignorovaném `test-results/`. Žádné klientské údaje ani přihlašovací údaje se necommitují.
- Chromium potřebovalo na tomto hostu knihovny rozbalené do izolovaného `/tmp` adresáře; nebylo použito sudo ani změny systémových balíčků.
- Přidáno CI pro PR do `main`: Node.js 24 + instalace/test/build, `contents: read`, bez nasazování. Skutečný stav GitHub runu je potřeba posuzovat podle PR kontrol, ne podle lokálního běhu.

## Opravy nezávislého review PR #1

Nálezy z [review na HEAD c838f85](https://github.com/afr0m3n/rentierska-kalkulacka/pull/1#pullrequestreview-5521688616) byly řešeny v původní větvi `fix/etapa-1-5` bez dalších finančních funkcí.

| Nález | Oprava | Regrese |
| --- | --- | --- |
| P1: kladný starobní důchod v měsíci narození / ve 26 letech | Přidán explicitní limit modelu: kladná částka nejdříve od 50 let, měsíčně přesně. Hlášení uvádí, že nejde o zákonný nárok. Nulová částka tento limit neaktivuje. | Unit: věk 0, 26, měsíc před 50. rokem, přesná hranice a nulová částka. E2E: chyby blokují výsledky a PDF. |
| P1: rok důchodu zůstane po změně narození zastaralý | `pensionYearSource` rozlišuje návrh a explicitní zadání. Změna ročníku upraví jen návrh; ruční zadání (i stejné hodnoty) jej zamkne. Staré uložené kalkulace bez metadat zachovají rok, protože jeho původ neznáme. | Unit: mladší/starší ročník, ruční zadání, v4 migrace a round-trip metadat. E2E: posun návrhu, zachování ručního data i po reloadu. |
| P2: první/poslední částečný rok grafu je mimo osu nebo oříznutý | Kapitál má stále přesné měsíční hranice; graf příjmů má vlastní osu od začátku prvního roku do konce posledního aktivního roku. Lednový exkluzivní konec nepřidává prázdný rok. | Unit: říjen 2026–říjen 2027, referenční příjmy 500 a 1 500 Kč/měs. E2E: skutečné obdélníky obou krajních sloupců jsou celé uvnitř plochy grafu. |
| P2: chyby v zavřené osobě / nejasný globální výnos | Zavřený `<summary>` má červený textový marker a počet chyb. Souhrn výsledků jmenuje neplatné osoby. U globálních výnosů se zobrazí název pole a konkrétní důvod. | E2E: chybná osoba zavřená, viditelný marker a jméno; oprava odstraní marker. Globální výnos 31 % ukáže konkrétní limit a po opravě hlášení zmizí. |

Hranice 50 let je záměrně široký produktový filtr tohoto modelu. Nepočítá legislativní důchodový věk ani nezavádí nová pravidla DPS. Přijetí pozdějšího data samo o sobě nepotvrzuje nárok.

Ověření oprav review (14. 10. 2026): `npm test` 60/60, `npm run test:e2e` 18/18 (desktop + mobil), `npm run build` a `git diff --check` úspěšné. Skutečné PDF bylo znovu staženo v obou viewports, všechny tři stránky otevřeny/renderovány a vizuálně zkontrolovány; tabulky, oba grafy a stránkování jsou čitelné. Artefakty zůstávají pouze v ignorovaném `test-results/`.
