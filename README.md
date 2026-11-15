# WhatsApp Claude bot

Bot, ki samodejno odgovarja na WhatsApp sporočila s pomočjo Claude API-ja. Poveže se kot "povezana naprava" (enako kot WhatsApp Web).

> ⚠️ To je neuradna povezava (Baileys) in krši pogoje uporabe WhatsAppa. Številka je lahko blokirana. Priporočam ločeno številko.

## Lokalni zagon

```bash
npm install
cp .env.example .env      # vpiši ANTHROPIC_API_KEY in ALLOWED_NUMBERS
npm start
```

V terminalu se izpiše QR koda. Na telefonu: **WhatsApp → Povezane naprave → Poveži napravo** in jo skeniraj. Prijava se shrani v mapo `auth/`, zato je naslednjič ne potrebuješ več.

## Kako ugotovim prave številke za ALLOWED_NUMBERS?

Vpiši številko v obliki `38640123456`. Bot v konzolo izpiše vsako prejeto sporočilo skupaj z ID-jem pošiljatelja (`📩 Ime [386...@s.whatsapp.net]`). Če nekdo ne dobi odgovora, preveri izpis. Novejši WhatsApp včasih uporablja ID-je `@lid` namesto številke. V tem primeru v `ALLOWED_NUMBERS` vpiši števke iz tega ID-ja.

## Postavitev na Railway (teče 24/7)

1. Kodo potisni v GitHub repo (`.env` in `auth/` sta v `.gitignore`).
2. Na Railwayu: **New Project → Deploy from GitHub repo**.
3. **Dodaj volumen** s potjo `/data`, sicer se prijava ob vsakem deployu izgubi.
4. Spremenljivke (Variables):
   - `ANTHROPIC_API_KEY`
   - `ALLOWED_NUMBERS`
   - `AUTH_DIR=/data/auth`
   - `PAIRING_NUMBER=386...` (tvoja številka, ker QR koda v logih ni berljiva)
   - po želji `SYSTEM_PROMPT`
5. Deploy. V **Logs** se izpiše `KODA ZA POVEZAVO: XXXX-XXXX`.
6. Telefon: **Povezane naprave → Poveži napravo → Poveži s telefonsko številko** in vpiši kodo.
7. Ko je povezava vzpostavljena, lahko `PAIRING_NUMBER` izbrišeš.

## Nastavitve

| Spremenljivka | Pomen |
|---|---|
| `SYSTEM_PROMPT` | Kako naj bot odgovarja (ton, kaj sme obljubiti) |
| `ALLOWED_NUMBERS` | Komu odgovarja; prazno pomeni vsem zasebnim pogovorom |
| `AI_DISCLOSURE` | `true`: prvi odgovor v pogovoru vsebuje opombo, da piše AI |
| `DEBOUNCE_MS` | Koliko časa počaka po zadnjem sporočilu, da odgovori enkrat namesto na vsako sporočilo posebej |
| `MODEL` | `claude-haiku-5-5` (poceni) ali `claude-sonnet-5-5` (boljši odgovori) |

Skupine, statusi in tvoja lastna sporočila se ignorirajo. Glasovna sporočila in slike bot zazna, a njihove vsebine ne razume.

## Ustavitev

Ustavi proces ali na telefonu v **Povezane naprave** odjavi napravo "Claude Bot".
