# Tree P2P Chat v2.2.7 — Jak kód sestavuje spojení (technologie, handshake, varianty)

> Tato dokumentace popisuje aktuální chování klientské aplikace (v2.2.7) při sestavování P2P spojení, včetně použitých technologií, signálování, voleb role Hub/Spoke a mechanismů obnovy sítě.

---

## 1) Cíl a topologie

Aplikace vytváří **P2P chat síť přes WebRTC DataChannel** a organizuje uzly do topologie **Hub & Spoke (strom)**:

- **Hub (Master)**: má **přímé WebRTC spojení** na každého připojeného účastníka (spoke).
- **Spoke (Node)**: typicky drží **jen spojení na hub**.
- Šíření zpráv je řešené aplikačním routováním (TTL + přeposílání přes otevřené kanály), což připomíná overlay síť.

---

## 2) Použité technologie (stack)

### 2.1 WebRTC pro přenos (RTCPeerConnection + DataChannel)

- `RTCPeerConnection` vytváří WebRTC spojení v prohlížeči.
- `RTCDataChannel` ("chat") je využit pro přenos chat zpráv a aplikačních paketů.
- Stav spojení je monitorován přes `pc.iceConnectionState` (např. `checking`, `connected`, `failed`).

**ICE konfigurace (NAT traversal):**
- STUN servery:
  - `stun:stun.cloudflare.com:3478`
  - `stun:stun.l.google.com:19302`
- TURN server:
  - `turn:openrelay.metered.ca:80` (veřejný relay, s uživatelským jménem a credential)

Výsledek ICE procesu určuje, zda spojení poběží:
- **přímo** (host/srflx), nebo
- **přes relay** (TURN → `relay`).

> Pozn.: aktuální kód primárně loguje ICE *stav*, ale nevyhodnocuje "jaký candidate-pair byl vybrán" (STUN vs TURN). Pro to je potřeba číst `pc.getStats()`.

---

### 2.2 Signaling přes Cloudflare Worker (HTTP polling)

Signálování (výměna SDP Offer/Answer) probíhá přes `fetch()` na HTTP API (Cloudflare Worker):

- **Zápis**: `POST` na Worker (`Content-Type: application/json`)
- **Čtení**: `GET` s parametry `?key=...&_t=...` (polling + cache-busting)
- Obsah je komprimován přes `pako.deflate()` a base64ován.

V praxi jde o mailbox / key-value pattern s klíči typu:
- `host-alive`
- `queue`
- `offer-{id}`
- `answer-{id}`

---

### 2.3 E2E šifrování obsahu (WebCrypto: ECDH + AES-GCM)

Každý uzel:

1. Generuje si klíčový pár pro **ECDH P-256** (`crypto.subtle.generateKey()`).
2. Ve zprávě typu `announce` šíří veřejný klíč (JWK).
3. Pro každého peera derivuje sdílený klíč:
   - ECDH → `deriveKey()` → **AES-GCM 256**
4. Šifruje obsah (payloady):
   - chat zprávy (per-recipient payloady)
   - synchronizaci historie (targeted)
   - přenos souborů (targeted, chunkované)

> Důležité: E2E se týká *obsahu*. Routovací obálka (TTL, typ, sender, path…) zůstává čitelná.

---

### 2.4 Aplikační routování zpráv (TTL, deduplikace, path tracing)

Klíčové vlastnosti routování:

- Deduplikace pomocí `seenMessages` (výjimky pro `sync-history`, `request-history`, `file-chunk`).
- Zpráva se **nejdřív vždy zpracuje lokálně** (`processPayload()`), teprve potom se případně forwarduje.
- `ttl` se sníží o 1, `path` se rozšiřuje o `myId` → umožňuje debug "kudy zpráva šla".
- Forward do všech otevřených kanálů kromě zdrojového.

---

## 3) Jak se rozhoduje role uzlu (Hub vs Spoke)

Po kliknutí na "Připojit do sítě" (`initSystem()`):

1. Nastaví nick `myName`, načte lokální historii, inicializuje kryptografii.
2. Přečte z Workeru klíč `host-alive`.
3. Pokud:
   - existuje hub
   - timestamp je čerstvý (do ~120 s)
   - hub není na blacklistu
   → uzel jde do režimu **Spoke** a spustí `joinViaDns()`.
4. Jinak se uzel stane **Hubem** a spustí `startDnsHostLoop()`.

---

## 4) Varianta A: Připojení jako Spoke (joinViaDns)

### 4.1 Spoke vytvoří Offer a zapíše ho do Workeru

- Vytvoří `RTCPeerConnection`.
- Jako iniciátor vytvoří `DataChannel`.
- `createOffer()` → `setLocalDescription()`.
- Čeká na ICE kandidáty (`waitForIce()`; cca do 3 s).
- Zapíše do Workeru:
  - `offer-{myId}` = `{ sdp, sid, ts }`.
- Zapíše se do `queue`, aby hub věděl, koho obsloužit.

### 4.2 Spoke pollingem hledá Answer

Periodicky (`joinInterval` každé cca 2 s):

- čte `answer-{myId}`
- hlídá:
  - čerstvost (`ts`)
  - session id (`sid`, přes `currentSessionId`)
- po úspěchu aplikuje:
  - `setRemoteDescription(answer)`
- následně ICE je schopno dokončit spojení a otevřít DataChannel.

### 4.3 Po otevření DataChannel

`bindDataChannel()`:

- uloží kanál do `channels[targetId]` (u spoke typicky `targetId='hub'`).
- odemkne UI.
- po krátkém delay:
  - rozešle `announce` (jméno + jwk)
  - pošle `request-history` (žádost o historii) ~3 s po announce
- udržuje jednoduchý ping/pong (aplikačně) každých ~10 s.

---

## 5) Varianta B: Uzlu se stane Hub (startDnsHostLoop)

### 5.1 Hub publikuje existenci a inicializuje frontu

- Nastaví `isDnsHost = true`.
- Vyčistí nebo inicializuje:
  - `queue`
  - `host-alive = { id, timestamp }`
- Periodicky obnovuje `host-alive`.

### 5.2 Hub obsluhuje připojování z fronty

V periodické smyčce (cca každé 3 s):

1. čte `queue` a bere první `guestId`
2. čte `offer-{guestId}`
3. vytvoří `RTCPeerConnection` jako responder:
   - `createP2PNode(guestId, false)`
4. aplikuje offer:
   - `setRemoteDescription(offer)`
5. vytvoří answer:
   - `createAnswer()` → `setLocalDescription(answer)`
6. po dokončení ICE gatheringu (`waitForIce()`) zapíše:
   - `answer-{guestId}` = `{ sdp, sid, ts }`

---

## 6) Failover a obnova po výpadku Hubu

Když se spoke odpojí od hubu, volá se `checkIsolation()`:

1. Zastaví joinovací polling.
2. Zkontroluje `host-alive`:
   - pokud existuje čerstvý hub, zkusí se znovu připojit.
3. Pokud čerstvý hub není:
   - spočte seznam "živých" uzlů z `knownNodes` dle `lastSeen`
   - nejnižší ID (po seřazení) vyhraje a stane se hubem
   - ostatní zkusí reconnect s jitterem, aby nevznikl konflikt

Navíc existuje blacklist mechanismus:
- pokud join vyprší (po ~10 pokusech), hub je blacklistován na ~2 minuty.

---

## 7) Synchronizace historie a přenos souborů (aplikačně)

### 7.1 Historie (hub → spoke)

- Spoke posílá `request-history`.
- Hub odpovídá `sync-history` v dávkách (batchSize=3).
- Každá dávka je E2E šifrovaná (AES-GCM přes ECDH) cíleně na žadatele.

### 7.2 Soubory (chunkování, E2E, targeted)

- Soubor se načte přes `FileReader` do base64.
- Chunkování (cca 16 KB).
- Každý chunk je poslán jako `file-chunk` a E2E šifrován pro konkrétního příjemce.
- Příjemce skládá chunk buffer, po kompletu vytvoří `data:` URL pro download.

---

## 8) STUN vs TURN vs ICE: co kód aktuálně ví a co ne

### 8.1 Co se děje v ICE (reálně)

WebRTC ICE může vybrat trasu:
- **host**: přímé lokální / LAN kandidáty
- **srflx**: STUN reflexní kandidáty (typicky přes NAT)
- **relay**: TURN relay (když přímé cesty selžou)

### 8.2 Co tvůj kód dnes zobrazuje

Aktuálně loguje:
- `pc.iceConnectionState`

Ale **nezjišťuje**, který typ kandidáta byl nakonec vybrán pro *konkrétní spojení*.

### 8.3 Co je potřeba pro detekci "jaká metoda se používá"

Pro identifikaci "STUN vs TURN" pro konkrétní peer-link je potřeba:
- `pc.getStats()` a vyhledat `candidate-pair` s `nominated/selected` + `state=succeeded`
- z něj přečíst `localCandidateId` a `remoteCandidateId` a jejich `candidateType` (`host/srflx/relay`)

Tato informace je ideální i pro:
- barvení spojnic v topologii,
- jednotný “healthcheck” přehled.

---

## 9) Přehled variant chování (stručný seznam)

### Signaling / role
- Připojení k existujícímu hubu: `offer -> answer` přes Worker + fronta `queue`
- Vytvoření hubu: publikace `host-alive`, vyzvedávání `queue`, generování `answer`
- Failover: izolace + volba hubu podle ID + jitter
- Blacklist hubu: při timeoutu joinu (~2 min ignorovat)

### WebRTC konektivita
- Přímý průchod (host/srflx) přes STUN
- Relay přes TURN (openrelay:80)
- Selhání při blokaci UDP/DTLS nebo nepovoleném TURN

### Přenos dat
- Chat: per-recipient E2E payloady
- Historie: targeted E2E `sync-history`
- Soubor: targeted E2E `file-chunk`

---

## 10) Budoucí úpravy pro další debug/telemetrii

Vidět skutečně používanou metodu (STUN/TURN) a synchronizovat ji napříč sítí, doplňení:

- ICE diagnostiku přes `pc.getStats()`
- u hubu agregaci metadat linků (iceType/protocol/rtt/state)
- rozesílání v `topo-sync`, aby:
  - topologie i healthcheck tabulka používaly stejný zdroj pravdy
  - barvy spojnic byly konzistentní napříč uzly

---
