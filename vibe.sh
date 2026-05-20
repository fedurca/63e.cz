#!/bin/bash

# 1. Kontrola, zda existuje index.html
if [ ! -f "index.html" ]; then
    echo "❌ Chyba: index.html nenalezen v aktuální složce!"
    exit 1
fi

# 2. Extrakce obsahu tagu <title> pomocí sed
RAW_TITLE=$(sed -n 's/.*<title>\(.*\)<\/title>.*/\1/p' index.html | head -n 1)

# 3. Očištění názvu pro bezpečné použití
SAFE_TITLE=$(echo "$RAW_TITLE" | tr ' ' '_' | tr -cd 'A-Za-z0-9_-')

if [ -z "$SAFE_TITLE" ]; then
    SAFE_TITLE="hra_zaloha"
fi

# 4. Získání aktuálního času
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# 5. Sestavení názvu výsledného souboru
ARCHIVE_NAME="${TIMESTAMP}_${SAFE_TITLE}.tar"

echo "📦 Vytvářím archiv herních souborů: $ARCHIVE_NAME"

# 6. Zabalení pouze tvých herních souborů
# - index.html
# - soubory *.js, které NEJSOU minifikované (ignoruje *.min.js)
# find . -maxdepth 1 -name "*.js" ! -name "*.min.js" vybere pouze tvé skripty
tar -cvf "$ARCHIVE_NAME" index.html $(find . -maxdepth 1 -name "*.js" ! -name "*.min.js")

echo "✅ Hotovo! Soubory jsou zabaleny v: $ARCHIVE_NAME"
