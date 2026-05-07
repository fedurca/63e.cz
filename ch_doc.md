Dokumentace k aplikaci E2E Tree P2P Chat
Verze: 3.8
Typ aplikace: Serverless / P2P Web Application (HTML/JS/CSS)
Klíčové technologie: WebRTC, WebCrypto API, Canvas API, JS Performance API

Uvod
Aplikace E2E Tree P2P Chat je plně decentralizovaný textový a video komunikátor běžící přímo v prohlížeči. Nevyžaduje žádný backend pro uchovávání dat - externí API (api.63e.cz) je využito pouze jako Signaling server pro počáteční výměnu spojovacích údajů (SDP, ICE). Komunikace a přenos dat následně probíhá čistě napřímo (P2P) mezi uživateli.

Klicove vlastnosti
1. Sitova architektura (Hub & Spoke)
Síť se automaticky formuje do stromové topologie (tzv. Hvězda / Hub & Spoke).

Master (Hub): První uzel v síti přebírá roli serveru. Přijímá připojení od ostatních uzlů a směruje zprávy/telemetrii napříč sítí.

Spoke (Klient): Ostatní uzly. Komunikují primárně přes Master uzel.

Auto-Failover: Pokud Master opustí síť (nebo mu vypadne připojení), síť se rozpadne a zbývající uzly provedou "volby" nového Mastera na základě timeoutu a izolačních algoritmů.

2. End-to-End (E2E) Sifrovani
Veškerá textová komunikace a soubory jsou šifrovány pomocí AES-GCM (256-bit).

K výměně klíčů dochází napřímo mezi každou dvojicí uzlů pomocí eliptických křivek ECDH (P-256) skrze WebCrypto API.

Šifrovací klíče se nikdy nedotknou zprostředkujícího Signaling serveru.

3. Komunikace a Media
Textový chat: Plně synchronizovaná historie mezi všemi účastníky (limit 250 zpráv).

Soubory: Přenos souborů do 5 MB. Rozdělováno na "chunks" (16 KB bloky), kódováno do Base64, šifrováno a po odeslání automaticky dekompletováno.

A/V Hovory (1:1): Podpora videohovorů, hlasových hovorů a sdílení obrazovky (Screen Share). P2P video stream je oddělený od textového DataChannelu.

4. Pokrocila Telemetrie a Diagnostika
U každého uzlu v síti (a v přehledu "Zdraví sítě") se dynamicky počítají a zobrazují tyto údaje:

RTT a Bitrate: Aktuální zpoždění linky a datová propustnost.

Detekce spojení: Zda jde o přímé (Direct P2P) nebo zprostředkované spojení (TURN/Relay).

Základní HW/SW údaje: OS, Prohlížeč, Rozlišení obrazovky a stav nabití baterie.

Jazyk a DPI: Preferovaný jazyk operačního systému (slouží i jako odhad klávesnice) a hustota pixelů (DPI) počítaná přes devicePixelRatio.

Geo-Ping Lokace: Odhad země pomocí asynchronního stahování miniatur (favicon) národních registrů (např. nic.cz, denic.de).

HW Performance Benchmark: Vestavěný Micro-Benchmark (FPU Stress Test na 5 milionů iterací odmocnin a sinů), který běží při startu a odhaduje výkon, kategorii HW a přibližný rok vydání zařízení.

Instalace a Spusteni
Jedná se o čistou klientskou (Front-end) aplikaci. Není třeba instalovat Node.js, databáze ani Apache/Nginx (pokud ji nehostujete).

Uložte kód do souboru, např. chat.html.

Otevřete tento soubor v jakémkoliv moderním prohlížeči (Chrome, Firefox, Safari, Edge).

DULEZITE: Většina funkcí (WebCrypto, Přístup ke kameře, Schránka) vyžaduje tzv. Secure Context. Soubor musí běžet přes protokol HTTPS nebo na lokálním prostředí (localhost / 127.0.0.1 / lokální otevření ze souborového systému file:///).

Zavislosti:
Aplikace využívá externí knihovnu Pako.js pro kompresi dat (Zlib/Deflate). Skript se ji pokusí nahrát lokálně z ./pako.min.js, a pokud chybí, automaticky použije CDN zálohu z cdnjs.

Pouziti URL Parametru (API chovani)
Aplikaci lze zavolat z externího systému a předat jí parametry přes URL pro zajištění "Auto-Connect" a "Auto-Send" (automatické připojení a odeslání zprávy bez zásahu uživatele).

Parametry:

n nebo nick: Přezdívka uživatele.

m nebo msg: Textová zpráva k odeslání.

Priklady pouziti:

https://mojedomena.cz/chat.html?n=Karel -> Automaticky vyplní přezdívku a zahájí připojování k síti.

https://mojedomena.cz/chat.html?n=Karel&m=Ahoj%20vsem -> Připojí se jako Karel. Po navázání spojení počká 2 sekundy na generování šifrovacích E2E klíčů a automaticky zprávu odešle do sítě, následně vyčistí URL adresu pro zamezení duplicitám.

Bezpecnost a Zvlastnosti prohlizecu
Zamrznutí a Zombie linky: Systém využívá robustní systém zasílání _ping a _pong signálů, aby odhalil tzv. Zombie spojení. Pokud uzel neodpoví do 60 vteřin, je nenávratně odstraněn ze směrovacích tabulek.

Obnova sítě (ICE Restart): Pro uživatele, kterým zamrzne video (např. při přechodu z Wi-Fi na LTE), je k dispozici tlačítko ICE Restart, které na pozadí domluví nové síťové trasy (Candidates) bez nutnosti zavírat hovor.

Auto-Session ID: Identifikátory uzlů jsou vázány na HW fingerprint zařízení (getStableNodeId()), nikoliv na dočasnou session prohlížeče. To zajišťuje stabilitu sítě i v momentě, kdy si uživatel obnoví stránku pomocí F5.

Zámky a ochrana UI: Aby nemohl uživatel poškodit spojení (např. zběsilým klikáním), jsou na kritické funkce napojené debounce zámky (např. ICE restart má cooldown 5 vteřin).

Vyvoj a Debuggovani
V dolní části obrazovky se nachází Systémový log. Význam jednotlivých událostí:

Zelená: Úspěšné navázání spojení, úspěšně přijatý soubor.

Žlutá/Oranžová: WebRTC logy, ICE stav, synchronizační pakety s historií.

Červená: Chyby, timeouty spojení, rozpad sítě.

Tyrkysová: Detaily o cestě paketu v síti (Tracing), informace o stahování a dekompletaci P2P souborů.

Taktéž lze sledovat graf topologie vykreslovaný pomocí Canvas 2D API. Přejetím kurzorem přes konkrétní spojnici se zobrazí detailní tooltip síťové telemetrie (zprostředkující server, protokol, zpoždění a stabilita) na dané lince.
