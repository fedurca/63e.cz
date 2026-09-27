// Quiet acoustic modem. Two devices share a soft perfect fifth (C and G).
// Pose bits ride on higher partials in separate bands, five frames a second.
(function (root) {
    const SR = 44100;
    const FRAME = 8820;
    const N = 441;
    const CP = 100;
    const STEP = N + CP;
    const NDATA = 14;
    const NSYM = NDATA + 2;
    const BODY = NSYM * STEP;
    const DATA_AMP = 0.04;
    const ROOT_AMP = 0.035;
    const PEAK = 0.16;
    const ALPH = "0123456789abcdefghijklmnopqrstuvwxyz";
    const BANKS = [
        { sync: 8, data: [10, 12, 14, 16, 18], root: 523.25, name: "C" },
        { sync: 24, data: [26, 28, 30, 32, 34], root: 783.99, name: "G" }
    ];

    function goertzel(samples, offset, bin) {
        const w = (2 * Math.PI * bin) / N;
        const coeff = 2 * Math.cos(w);
        let s0 = 0, s1 = 0, s2 = 0;
        for (let i = 0; i < N; i++) {
            const x = samples[offset + i] || 0;
            s0 = x + coeff * s1 - s2;
            s2 = s1;
            s1 = s0;
        }
        return s1 * s1 + s2 * s2 - coeff * s1 * s2;
    }

    function addTone(out, freq, start, amp) {
        const end = Math.min(out.length, start + STEP);
        for (let i = start; i < end; i++) {
            const u = (i - start) / STEP;
            const e = u < 0.15 ? u / 0.15 : u > 0.85 ? (1 - u) / 0.15 : 1;
            out[i] += amp * e * Math.sin(2 * Math.PI * freq * i / SR);
        }
    }

    function encodeFrame(bankId, symbols, rootPhase) {
        const bank = BANKS[bankId] || BANKS[0];
        const out = new Float32Array(FRAME);
        let phase = rootPhase || 0;
        const rootW = 2 * Math.PI * bank.root / SR;
        for (let i = 0; i < FRAME; i++) {
            phase += rootW;
            out[i] += ROOT_AMP * Math.sin(phase);
        }
        addTone(out, bank.sync * SR / N, 0, DATA_AMP);
        for (let k = 0; k < bank.data.length; k++) addTone(out, bank.data[k] * SR / N, STEP, DATA_AMP);
        for (let s = 0; s < NDATA; s++) {
            const bits = symbols[s] || 0;
            for (let k = 0; k < 5; k++) {
                if ((bits >> k) & 1) addTone(out, bank.data[k] * SR / N, (s + 2) * STEP, DATA_AMP);
            }
        }
        let peak = 0;
        for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
        if (peak > PEAK) {
            const g = PEAK / peak;
            for (let i = 0; i < out.length; i++) out[i] *= g;
        }
        return { pcm: out, rootPhase: phase };
    }

    function findSync(samples, bin) {
        let best = -1;
        let at = 0;
        const last = Math.max(0, samples.length - STEP);
        for (let i = 0; i <= last; i += 4) {
            const e = goertzel(samples, i + CP, bin);
            if (e > best) { best = e; at = i; }
        }
        const a = Math.max(0, at - 8);
        const b = Math.min(last, at + 8);
        for (let i = a; i <= b; i++) {
            const e = goertzel(samples, i + CP, bin);
            if (e > best) { best = e; at = i; }
        }
        return { at: at, energy: best };
    }

    function decodeBank(samples, bankId) {
        const bank = BANKS[bankId];
        const sync = findSync(samples, bank.sync);
        const ref = bank.data.map(function (bin) { return goertzel(samples, sync.at + STEP + CP, bin); });
        const symbols = [];
        for (let n = 0; n < NDATA; n++) {
            let v = 0;
            const start = sync.at + (n + 2) * STEP + CP;
            for (let k = 0; k < 5; k++) {
                const e = goertzel(samples, start, bank.data[k]);
                if (ref[k] > sync.energy * 0.003 && e > ref[k] * 0.4) v |= 1 << k;
            }
            symbols.push(v);
        }
        const refMean = ref.reduce(function (a, b) { return a + b; }, 0) / Math.max(1, ref.length);
        const confident = sync.energy > 0.015 && refMean > sync.energy * 0.02;
        return { bank: bankId, name: bank.name, symbols: symbols, energy: sync.energy, at: sync.at, confident: confident };
    }

    function decodeAll(samples) {
        let rms = 0;
        const n = samples ? samples.length : 0;
        for (let i = 0; i < n; i += 16) rms += samples[i] * samples[i];
        rms = n ? Math.sqrt(rms / Math.ceil(n / 16)) : 0;
        return {
            rms: rms,
            banks: [decodeBank(samples, 0), decodeBank(samples, 1)]
        };
    }

    function bitsFromSymbols(symbols) {
        const bits = [];
        for (let s = 0; s < NDATA; s++) {
            const v = symbols[s] || 0;
            for (let b = 0; b < 5; b++) bits.push((v >> b) & 1);
        }
        return bits;
    }

    function symbolsFromBits(bits) {
        const symbols = [];
        for (let i = 0; i < NDATA; i++) {
            let v = 0;
            for (let b = 0; b < 5; b++) if (bits[i * 5 + b]) v |= 1 << b;
            symbols.push(v);
        }
        return symbols;
    }

    function readBits(bits, at, n) {
        let v = 0;
        for (let i = 0; i < n; i++) v = (v << 1) | (bits[at + i] ? 1 : 0);
        return v;
    }

    function writeBits(bits, value, n) {
        for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    }

    function crc8bits(bits, n) {
        let c = 0;
        for (let i = 0; i < n; i++) {
            c ^= bits[i] ? 0x80 : 0;
            for (let b = 0; b < 8; b++) c = (c & 0x80) ? ((c << 1) ^ 0x07) & 255 : (c << 1) & 255;
        }
        return c;
    }

    function writeId(bits, id) {
        const clean = String(id || "").toLowerCase().replace(/[^0-9a-z]/g, "").slice(0, 6).padEnd(6, "0");
        for (let i = 0; i < 6; i++) writeBits(bits, Math.max(0, ALPH.indexOf(clean[i])), 6);
    }
    function readId(bits, at) {
        let id = "";
        for (let i = 0; i < 6; i++) {
            const v = readBits(bits, at + i * 6, 6);
            if (v < 0 || v >= ALPH.length) return "";
            id += ALPH[v];
        }
        return id === "000000" ? "" : id;
    }
    function seal(bits) {
        while (bits.length < 62) bits.push(0);
        const body = bits.slice(0, 62);
        writeBits(body, crc8bits(body, 62), 8);
        return symbolsFromBits(body);
    }

    function packPose(id, pose) {
        const bits = [];
        writeBits(bits, 0, 1);
        writeId(bits, id);
        const x = Math.max(0, Math.min(511, Math.round((pose && pose.x) || 0) / 10));
        const y = Math.max(0, Math.min(255, Math.round((pose && pose.y) || 0) / 16));
        writeBits(bits, x, 9);
        writeBits(bits, y, 8);
        writeBits(bits, ((pose && pose.hp) || 0) & 15, 4);
        writeBits(bits, ((pose && pose.lvl) || 0) & 15, 4);
        return seal(bits);
    }

    function packChat(id, text, seq) {
        const utf = new TextEncoder().encode(String(text || "").slice(0, 36));
        if (!utf.length) return [];
        const head = utf.subarray(0, 1);
        const rest = utf.subarray(1);
        const bodies = [];
        for (let i = 0; i < rest.length; i += 5) bodies.push(rest.subarray(i, i + 5));
        const count = 1 + bodies.length;
        if (count > 8) return [];
        function frame(part, payload, withId) {
            const bits = [];
            writeBits(bits, 1, 1);
            writeBits(bits, seq & 15, 4);
            writeBits(bits, part & 7, 3);
            writeBits(bits, (count - 1) & 7, 3);
            if (withId) writeId(bits, id);
            writeBits(bits, payload.length & 15, 4);
            for (let i = 0; i < payload.length; i++) writeBits(bits, payload[i], 8);
            return seal(bits);
        }
        const out = [frame(0, head, true)];
        for (let i = 0; i < bodies.length; i++) out.push(frame(i + 1, bodies[i], false));
        return out;
    }

    function unpackFrame(symbols) {
        const bits = bitsFromSymbols(symbols);
        if (bits.length < 70) return null;
        if (readBits(bits, 62, 8) !== crc8bits(bits, 62)) return null;
        if (readBits(bits, 0, 1) === 0) {
            const id = readId(bits, 1);
            if (!id) return null;
            let at = 37;
            const x = readBits(bits, at, 9); at += 9;
            const y = readBits(bits, at, 8); at += 8;
            const hp = readBits(bits, at, 4); at += 4;
            const lvl = readBits(bits, at, 4);
            return { kind: "pose", id: id, x: x * 10, y: y * 16, hp: hp, lvl: lvl };
        }
        const seq = readBits(bits, 1, 4);
        const part = readBits(bits, 5, 3);
        const count = readBits(bits, 8, 3) + 1;
        let at = 11;
        let id = "";
        if (part === 0) {
            id = readId(bits, at);
            at += 36;
            if (!id) return null;
        }
        const plen = readBits(bits, at, 4); at += 4;
        const maxLen = part === 0 ? 1 : 5;
        if (plen > maxLen || at + plen * 8 > 62) return null;
        const bytes = [];
        for (let i = 0; i < plen; i++) {
            bytes.push(readBits(bits, at, 8));
            at += 8;
        }
        return { kind: "chat", seq: seq, part: part, count: count, id: id, bytes: bytes };
    }

    root.AudioCodec = {
        SR: SR,
        FRAME: FRAME,
        BANKS: BANKS,
        encodeFrame: encodeFrame,
        decodeAll: decodeAll,
        packPose: packPose,
        packChat: packChat,
        unpackFrame: unpackFrame
    };
})(typeof self !== "undefined" ? self : this);
