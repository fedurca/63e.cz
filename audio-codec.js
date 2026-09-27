// Pure encode/decode for the musical audio link. No DOM, safe inside a Worker.
(function (root) {
    const SR = 44100;
    const NOTES = [
        220.00, 261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33,
        659.25, 783.99, 880.00, 1046.50, 1174.66, 1318.51, 1567.98, 1760.00
    ];
    const PREAMBLE = [0, 15, 0, 15, 1, 14];
    const SYMBOL = Math.round(SR * 0.028);
    const GAP = Math.round(SR * 0.006);
    const STEP = SYMBOL + GAP;
    const FILLER = [4, 6, 5, 7, 5, 4];
    const COEFFS = NOTES.map(freq => {
        const k = Math.round((SYMBOL * freq) / SR);
        const w = (2 * Math.PI * k) / SYMBOL;
        return 2 * Math.cos(w);
    });

    function crc8(bytes) {
        let c = 0;
        for (let i = 0; i < bytes.length; i++) {
            c ^= bytes[i];
            for (let b = 0; b < 8; b++) {
                c = (c & 0x80) ? ((c << 1) ^ 0x07) & 255 : (c << 1) & 255;
            }
        }
        return c;
    }

    const PLUCKS = NOTES.map(freq => {
        const wave = new Float32Array(SYMBOL);
        for (let i = 0; i < SYMBOL; i++) {
            const u = i / SYMBOL;
            const env = Math.exp(-1.7 * u) * Math.sin(Math.PI * u);
            wave[i] = 0.16 * env * Math.sin(2 * Math.PI * freq * i / SR);
        }
        return wave;
    });

    function renderSymbols(syms) {
        const n = syms.length * STEP + Math.round(SR * 0.08);
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const t = i / SR;
            out[i] = 0.03 * Math.sin(2 * Math.PI * 110 * t) + 0.02 * Math.sin(2 * Math.PI * 164.81 * t);
        }
        for (let k = 0; k < syms.length; k++) {
            const wave = PLUCKS[syms[k]] || PLUCKS[0];
            const start = k * STEP;
            for (let i = 0; i < SYMBOL; i++) out[start + i] += wave[i];
        }
        let peak = 0;
        for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
        if (peak > 0.22) {
            const g = 0.22 / peak;
            for (let i = 0; i < n; i++) out[i] *= g;
        }
        return out;
    }

    function encodePacket(bytes) {
        const payload = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
        const crc = crc8(payload);
        const framed = [payload.length];
        for (let i = 0; i < payload.length; i++) framed.push(payload[i]);
        framed.push(crc);
        const syms = PREAMBLE.slice();
        for (let i = 0; i < framed.length; i++) {
            syms.push((framed[i] >> 4) & 15, framed[i] & 15);
        }
        for (let i = 0; i < FILLER.length; i++) syms.push(FILLER[i]);
        return renderSymbols(syms);
    }

    function goertzel(samples, offset, coeff) {
        let s0 = 0, s1 = 0, s2 = 0;
        const end = offset + SYMBOL;
        for (let i = offset; i < end; i++) {
            s0 = samples[i] + coeff * s1 - s2;
            s2 = s1;
            s1 = s0;
        }
        return s1 * s1 + s2 * s2 - coeff * s1 * s2;
    }

    function readSymbol(samples, offset) {
        if (offset < 0 || offset + SYMBOL > samples.length) return -1;
        let best = 0, second = 0, idx = 0;
        for (let n = 0; n < COEFFS.length; n++) {
            const p = goertzel(samples, offset, COEFFS[n]);
            if (p > best) { second = best; best = p; idx = n; }
            else if (p > second) second = p;
        }
        if (best < 0.00005 || (second > 0 && best < second * 1.28)) return -1;
        return idx;
    }

    function tryDecodeAt(samples, offset) {
        for (let i = 0; i < PREAMBLE.length; i++) {
            if (readSymbol(samples, offset + i * STEP) !== PREAMBLE[i]) return null;
        }
        let p = offset + PREAMBLE.length * STEP;
        const lenHi = readSymbol(samples, p);
        const lenLo = readSymbol(samples, p + STEP);
        if (lenHi < 0 || lenLo < 0) return null;
        const len = (lenHi << 4) | lenLo;
        if (len < 1 || len > 48) return null;
        p += 2 * STEP;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            const hi = readSymbol(samples, p);
            const lo = readSymbol(samples, p + STEP);
            if (hi < 0 || lo < 0) return null;
            bytes[i] = (hi << 4) | lo;
            p += 2 * STEP;
        }
        const crcHi = readSymbol(samples, p);
        const crcLo = readSymbol(samples, p + STEP);
        if (crcHi < 0 || crcLo < 0) return null;
        if (((crcHi << 4) | crcLo) !== crc8(bytes)) return null;
        return { bytes: bytes, symbols: PREAMBLE.length + (len + 2) * 2 };
    }

    function decodeAll(samples) {
        const found = [];
        const minLen = (PREAMBLE.length + 8) * STEP;
        const hop = Math.floor(STEP / 4);
        for (let off = 0; off + minLen < samples.length;) {
            const pkt = tryDecodeAt(samples, off);
            if (!pkt) { off += hop; continue; }
            found.push(pkt.bytes);
            off += pkt.symbols * STEP;
        }
        return found;
    }

    function u16(n) {
        n = Math.max(0, Math.min(65535, Math.round(n || 0)));
        return [n & 255, (n >> 8) & 255];
    }
    function rd16(b, i) { return b[i] | (b[i + 1] << 8); }

    function buildBeacon(id, pose) {
        const raw = String(id || "").slice(0, 6).padEnd(6, " ");
        const bytes = [1];
        for (let i = 0; i < 6; i++) bytes.push(raw.charCodeAt(i) & 127);
        bytes.push((pose.lvl || 0) & 255);
        const x = u16(pose.x), y = u16(pose.y);
        bytes.push(x[0], x[1], y[0], y[1], (pose.hp || 0) & 255);
        return bytes;
    }

    function buildEnemies(lvl, list) {
        const src = (list || []).slice(0, 5);
        const bytes = [2, lvl & 255, src.length];
        for (let i = 0; i < src.length; i++) {
            const e = src[i];
            const x = u16(e.x), y = u16(e.y);
            bytes.push((e.i || 0) & 255, x[0], x[1], y[0], y[1]);
        }
        return bytes;
    }

    function parsePacket(bytes) {
        if (!bytes || !bytes.length) return null;
        if (bytes[0] === 1 && bytes.length >= 13) {
            let id = "";
            for (let i = 1; i <= 6; i++) id += String.fromCharCode(bytes[i]);
            return {
                type: "peer",
                id: id.trim(),
                lvl: bytes[7],
                x: rd16(bytes, 8),
                y: rd16(bytes, 10),
                hp: bytes[12]
            };
        }
        if (bytes[0] === 2 && bytes.length >= 3) {
            const lvl = bytes[1];
            const n = bytes[2];
            const enemies = [];
            let p = 3;
            for (let i = 0; i < n && p + 5 <= bytes.length; i++) {
                enemies.push({ i: bytes[p], x: rd16(bytes, p + 1), y: rd16(bytes, p + 3) });
                p += 5;
            }
            return { type: "enemies", lvl: lvl, enemies: enemies };
        }
        if (bytes[0] === 3 && bytes.length >= 8) {
            let id = "";
            for (let i = 1; i <= 6; i++) id += String.fromCharCode(bytes[i]);
            const n = bytes[7];
            const slice = bytes.subarray(8, 8 + n);
            let text = "";
            try { text = new TextDecoder().decode(slice); } catch (e) { text = ""; }
            return { type: "chat", id: id.trim(), text: text };
        }
        return null;
    }

    function buildChat(id, text) {
        const raw = String(text || "").slice(0, 42);
        const utf = new TextEncoder().encode(raw);
        const bytes = [3];
        const idr = String(id || "").slice(0, 6).padEnd(6, " ");
        for (let i = 0; i < 6; i++) bytes.push(idr.charCodeAt(i) & 127);
        const n = Math.min(utf.length, 42);
        bytes.push(n);
        for (let i = 0; i < n; i++) bytes.push(utf[i]);
        return bytes;
    }

    root.AudioCodec = {
        encodePacket: encodePacket,
        decodeAll: decodeAll,
        parsePacket: parsePacket,
        buildBeacon: buildBeacon,
        buildEnemies: buildEnemies,
        buildChat: buildChat
    };
})(typeof self !== "undefined" ? self : this);
