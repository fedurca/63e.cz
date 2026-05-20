#!/bin/bash

# 1. Kontrola, zda existuje index.html
if [ ! -f "index.html" ]; then
    echo "❌ Chyba: index.html nenalezen v aktuální složce!"
    exit 1
fi

# 2. Extrakce obsahu tagu <title> pomocí sed
RAW_TITLE=$(sed -n 's/.*<title>\(.*\)<\/title>.*/\1/p' index.html | head -n 1)

# 3. Očištění názvu pro bezpečné použití v souborovém systému
# Nahradí mezery podtržítky a odstraní vše, co nejsou písmena, čísla, pomlčky nebo podtržítka
SAFE_TITLE=$(echo "$RAW_TITLE" | tr ' ' '_' | tr -cd 'A-Za-z0-9_-')

# Fallback, pokud by se title nepovedlo vyčíst
if [ -z "$SAFE_TITLE" ]; then
    SAFE_TITLE="hra_zaloha"
fi

# 4. Získání aktuálního času (formát RokMesicDen_HodinaMinutaSekunda)
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# 5. Sestavení názvu výsledného souboru
ARCHIVE_NAME="${TIMESTAMP}_${SAFE_TITLE}.tar"

echo "📦 Vytvářím archiv: $ARCHIVE_NAME"

# 6. Zabalení vytvořených souborů (index a 3 JS moduly)
# Pokud máš ve složce i stažené pako.min.js, můžeš ho sem dopsat,
# nebo použít wildcard: tar -cvf "$ARCHIVE_NAME" *.html *.js
tar -cvf "$ARCHIVE_NAME" index.html maps.js network.js game.js

echo "✅ Hotovo! Soubory jsou úspěšně zabaleny v: $ARCHIVE_NAME"
