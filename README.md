# Rentiérská kalkulačka

Statická klientská aplikace pro orientační modelaci akumulace kapitálu a následného čerpání renty z investic, doplňkového penzijního spoření (DPS) a státního důchodu.

## Požadavky

- Node.js 24 LTS
- npm 11+

V tomto vývojovém prostředí je ověřená oficiální distribuce Node.js 24.21.0 nainstalovaná bez `sudo` pod `~/.local/opt/node`; spustitelné odkazy jsou v `~/.local/bin`, který je součástí uživatelského login `PATH`. Soubor `.node-version` fixuje použitou verzi pro nástroje, které jej podporují.

## Vývoj

```bash
npm ci
npm run dev
```

Kontroly a produkční build:

```bash
npm test
npm run build
```

Výstup je v `dist/` a používá relativní cesty (`base: './'`), takže jej lze nahrát na běžný statický webhosting. Aplikace nemá backend a neposílá klientská data na server. Rozpracovanou kalkulaci ukládá do `localStorage` pouze po výslovném souhlasu uživatele.

## Struktura

- `src/model/` – čisté typy, validace, simulace a numerické řešiče
- `src/main.ts` – vazba UI, grafů, stavu a PDF exportu
- `src/pdf/` – testovatelná logika stránkování PDF
- `src/state/` – validovatelná migrace starších uložených kalkulací
- `tests/` – numerické, hraniční a validační testy
- `docs/AUDIT.md` – audit původní aplikace a stav nálezů
- `docs/ROADMAP.md` – doporučené další etapy
- `legacy.html` – nezměněný zdroj původní jednosouborové aplikace

## Základní předpoklady modelu

- Milníky věku nastávají v zadaném měsíci narození. Začátek státního důchodu má vlastní měsíc a rok.
- Kladný starobní důchod před 50. rokem je mimo podporovaný rozsah kalkulačky. Jde o produktový limit pro zjevně nevěrohodná zadání, nikoli zákonný důchodový věk nebo potvrzení nároku.
- Navržený rok důchodu (výchozí věk 65 let) sleduje změny roku narození. Po ruční úpravě roku důchodu se už neposouvá. Starší uložené termíny bez informace o jejich původu zůstávají zachované.
- Starší v2/v3 kalkulace zachovají vstupy, chybějící měsíce však vyžadují doplnění. Bez něj se výsledky nezobrazí. V4 používá nový klíč úložiště; starší data se automaticky nemažou.
- Cílová renta znamená celkový požadovaný příjem včetně DPS a státního důchodu. Skutečné výplaty, pokrytí cíle, přebytek a schodek jsou oddělené. Přebytek se nereinvestuje.
- Před začátkem renty je cílový příjem neaktivní (0); případný státní důchod se zaznamená jako příjem mimo cíl a neovlivní investiční kapitál.
- Potřebná úložka a doporučené navýšení jsou zaokrouhleny nahoru na Kč; udržitelná renta dolů. Zaokrouhlené scénáře se znovu simulují.
- Zadaný výnos je nominální roční sazba; měsíční sazba je `p.a. / 12`.
- Vklad či výběr proběhne na začátku měsíce a následně se připíše měsíční výnos.
- DPS se vyplácí jako anuita na přesně zadanou dobu a mimo toto období rentu nedorovnává.
- Inflace, valorizace, poplatky, daně a sdílený kapitál domácnosti zatím nejsou součástí modelu.

Podrobnosti a legislativní omezení jsou v [docs/AUDIT.md](docs/AUDIT.md).

## Browserové testy a PDF

```bash
npx playwright install chromium
npm run build
npm run test:e2e
```

Testy spouštějí lokální Vite preview produkčního `dist/` podle [Playwright webServer](https://playwright.dev/docs/test-webserver). Běží s pevným datem 14. 10. 2026 na desktopu a mobilním viewportu Pixel 7. Ověřují validaci, migraci a souhlas s ukládáním, skutečné příjmy a přebytky, přepínání domácnosti, rozměry stránky a viditelné sloupce. PDF se skutečně stáhne, otevře a všechny stránky vykreslí přes PDF.js; výstupy v `test-results/` se necommitují. Testovací jména a částky jsou syntetické.

Na minimálním Linux hostu může Chromium potřebovat další sdílené knihovny. Při ověřování této etapy byly knihovny Debianu pouze rozbaleny do `/tmp` a poskytnuty přes `LD_LIBRARY_PATH`; systémové balíčky se neměnily. Samotné `npm ci`, `npm test` a `npm run build` browserové knihovny nepotřebují.

## GitHub workflow

Vývoj probíhá v pracovní větvi a přes Pull Request do `main`. GitHub Actions v `.github/workflows/ci.yml` pro PR spouštějí Node.js 24, `npm ci`, `npm test` a `npm run build`. Token má pouze `contents: read`, checkout neukládá přihlašovací údaje a CI nic nenasazuje. E2E je samostatná lokální kontrola; její automatické spuštění v CI je další možné rozšíření.
