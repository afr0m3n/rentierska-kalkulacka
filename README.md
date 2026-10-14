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
- `tests/` – numerické, hraniční a validační testy
- `docs/AUDIT.md` – audit původní aplikace a stav nálezů
- `docs/ROADMAP.md` – doporučené další etapy
- `legacy.html` – nezměněný zdroj původní jednosouborové aplikace

## Základní předpoklady modelu

- Věk se z dostupného ročníku počítá od 1. ledna.
- Zadaný výnos je nominální roční sazba; měsíční sazba je `p.a. / 12`.
- Vklad či výběr proběhne na začátku měsíce a následně se připíše měsíční výnos.
- DPS se vyplácí jako anuita na přesně zadanou dobu a mimo toto období rentu nedorovnává.
- Inflace, valorizace, poplatky, daně a sdílený kapitál domácnosti zatím nejsou součástí modelu.

Podrobnosti a legislativní omezení jsou v [docs/AUDIT.md](docs/AUDIT.md).
