# Roadmapa

## Dokončená etapa 1.5

Konzervativní celočíselné výsledky ověřené simulací, numerické hranice, měsíce narození/důchodu, migrace v2/v3, skutečné příjmy oddělené od cíle a přebytku, kalendářní agregace, kompletní uzamčený PDF export a browserové E2E desktop/mobile. Vývoj přes pracovní větve a PR; základní CI pro `main` bez nasazování.

## Etapa 2 – schválené finanční předpoklady

1. Sepsat a produktově schválit význam cílové renty: nominální vs. reálná částka a její valorizace.
2. Doplnit inflaci, valorizaci státního důchodu, produktové poplatky a daňové zacházení jako explicitní, verzované vstupy.
3. Rozhodnout, zda výnos zůstane nominální sazbou dělenou 12, nebo bude zadáván jako efektivní roční výnos.
4. Rozlišit typ DPS a datum/splněnou dobu smlouvy; teprve poté automaticky vyhodnocovat nárok na konkrétní dávku.
5. Přesunout nárok na státní příspěvek na úroveň osoby a oddělit příspěvek účastníka od příspěvku zaměstnavatele.

## Etapa 3 – flexibilní časová osa

1. Zavést nezávislé začátky a konce pravidelného spoření pro investice a DPS.
2. Navrhnout explicitní zacházení s DPS čerpaným před cílovou rentou.
3. Podpořit již probíhající rentu pomocí dnešního stavu a odděleného režimu bez tvrzení o historickém kapitálu.
4. Umožnit více jednorázových vkladů/výběrů s přesným měsícem.

## Etapa 4 – domácnost

1. Přidat volitelný sdílený investiční účet domácnosti.
2. Definovat prioritu čerpání mezi osobními a společnými zdroji.
3. Doplnit scénáře úmrtí, dědictví a změny příjmů pouze po schválení zadání.
4. Souhrnné ukazatele počítat vždy ke společnému referenčnímu datu.

## Etapa 5 – kvalita výstupů

1. Rozšířit existující browserové E2E o další prohlížeče, dark mode a trvalé vizuální baseline; případně je přidat do CI.
2. Zlepšit PDF na sémantické stránkování tabulek s opakováním hlaviček.
3. Přidat export/import anonymizovaného JSON souboru jako alternativu k `localStorage`.
4. Provést přístupnostní audit klávesnice, kontrastu, chybových hlášení a grafických alternativ.

## Průběžná údržba

- Jednou ročně nebo po legislativní změně ověřit pravidla DPS a státního příspěvku proti primárním zdrojům.
- Aktualizovat závislosti po samostatné kontrole `npm test`, `npm run build` a PDF exportu.
- Každou změnu matematického modelu doprovodit numerickou referencí a hraničními testy.
