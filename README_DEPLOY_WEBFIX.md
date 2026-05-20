# P2P v23 webfix deploy

Tento balík opravuje problém, kdy lokální test funguje, ale webová verze načte starý nebo nekompatibilní JS/map soubor z cache a hra spadne na:

`Cannot read properties of undefined (reading '0')`

Co je změněno:

- `game.js` importuje `maps.js?v=20260520-webfix` a normalizuje levely, takže nespadne ani při starším tvaru LVL.
- `maps.js` je samostatný soubor s mapami, není už jen přesměrování přes `map.js`.
- `index.html` má cache-busting pro `network.js` a `game.js`.
- `index.html` při startu zkusí odregistrovat starý Service Worker a smazat staré herní cache.
- `sw.js` je změněný na network-first a smaže staré cache.

Po nahrání na web otevři jednou:

https://63e.cz/?n=TTA&v=20260520-webfix

V Chrome DevTools je dobré dát Application → Service Workers → Unregister a Application → Storage → Clear site data.
