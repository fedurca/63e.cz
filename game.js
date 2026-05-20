import kaboom from "https://unpkg.com/kaboom@3000.1.17/dist/kaboom.mjs";
import { LVL } from "./maps.js";

let audioCtx = null;

const getIsHost = () => typeof window.chat_isHost === 'function' ? window.chat_isHost() : true;

function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}
window.initAudioContextGlobal = initAudio;

function playSound(freq, type, duration, vol = 0.1) {
    if (!audioCtx) return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type; 
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(freq / 2, audioCtx.currentTime + duration);
        gain.gain.setValueAtTime(vol, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        osc.connect(gain); 
        gain.connect(audioCtx.destination);
        osc.start(); 
        osc.stop(audioCtx.currentTime + duration);
    } catch(e){}
}

function vibrate(pattern) {
    if (typeof window.navigator.vibrate === 'function') {
        try { window.navigator.vibrate(pattern); } catch(e){}
    }
}

window.addEventListener('click', initAudio); 
window.addEventListener('keydown', initAudio); 
window.addEventListener('touchstart', initAudio);

function getPlayerColor(nodeId) {
    let hash = 0;
    for (let i = 0; i < nodeId.length; i++) hash = nodeId.charCodeAt(i) + ((hash << 5) - hash);
    const colors = [
        { r: 255, g: 80, b: 80 }, { r: 80, g: 255, b: 80 }, { r: 255, g: 255, b: 80 },
        { r: 80, g: 180, b: 255 }, { r: 255, g: 180, b: 80 }, { r: 220, g: 80, b: 255 }, { r: 80, g: 255, b: 255 }
    ];
    const c = colors[Math.abs(hash) % colors.length];
    return rgb(c.r, c.g, c.b);
}

let useTilt = false; 
let tiltAccel = 0;
let tiltInitialized = false; 

function addToast(msg) {
    if (typeof add === "undefined") return; 
    add([
        text(msg, {size: 16}), pos(width()/2, 80), color(0, 255, 255),
        anchor("center"), fixed(), z(200), lifespan(2.5, { fade: 0.5 })
    ]);
}

function handleOrientation(event) {
    let tilt = 0;
    let angle = window.orientation || (window.screen && window.screen.orientation && window.screen.orientation.angle) || 0;
    
    if (angle === 90) tilt = event.beta;
    else if (angle === -90) tilt = -event.beta;
    else tilt = event.gamma; 

    if (tilt > 12) tiltAccel = 1;
    else if (tilt < -12) tiltAccel = -1;
    else tiltAccel = 0;
}

function tryEnableTilt(showToast = false) {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().then(response => {
            if (response === 'granted') {
                window.addEventListener('deviceorientation', handleOrientation);
                useTilt = true;
                if (showToast) addToast("Naklánění: ZAPNUTO (vypneš dvojklikem)");
            } else {
                useTilt = false;
                if (showToast) addToast("Naklánění: ZAMÍTNUTO");
            }
        }).catch(console.error);
    } else {
        window.addEventListener('deviceorientation', handleOrientation);
        useTilt = true;
        if (showToast) addToast("Naklánění: ZAPNUTO (vypneš dvojklikem)");
    }
}

function initTiltOnInteraction() {
    if (tiltInitialized) return;
    tiltInitialized = true;
    tryEnableTilt(true); 
}
window.addEventListener('click', initTiltOnInteraction);
window.addEventListener('touchstart', initTiltOnInteraction);

kaboom({ canvas: document.getElementById("game-canvas"), width: 800, height: 480, letterbox: true, crisp: true, background: [0, 0, 0], scale: 1 });

const TEXTS = {
    debugTitle: "=== DEBUG INFO ===",
    debugLevel: (lvl) => `Level: ${lvl}/12`, debugHP: (hp, max) => `HP: ${hp}/${max}`,
    debugAmmo: (ammo) => `Ammo: ${ammo}`, debugScore: (sc) => `Score: ${sc}`,
    debugPos: (x, y) => `Pozice: (${x.toFixed(0)}, ${y.toFixed(0)})`, debugVel: (v) => `Rychlost: ${v.toFixed(1)}`,
    debugGround: (g) => `Na zemi: ${g}`, debugStun: (s) => `Stun: ${s}`,
    debugGravity: (g) => `Gravitace: ${g}`, debugEnemies: (n) => `Nepřátel: ${n}`,
    debugCoins: (n) => `Mincí: ${n}`, debugFPS: (fps) => `FPS: ${fps}`,
    debugTime: (t) => `Čas: ${t.toFixed(1)}s`
};

function generateStickmanSVG() {
    const origFrames = [
        `<g transform="translate(0,0)"><circle cx="16" cy="12" r="5" fill="white"/><path d="M16 17v11M16 18l-4 6-2 6M16 18l4 6 2 6M16 28l-4 8v8M16 28l4 8v8"/></g>`,
        `<g transform="translate(32,0)"><circle cx="16" cy="13" r="5" fill="white"/><path d="M16 18v11M16 19l-5 6-1 6M16 19l5 6 1 6M16 29l-5 7v8M16 29l5 7v8"/></g>`,
        `<g transform="translate(64,0)"><circle cx="16" cy="11" r="5" fill="white"/><path d="M16 16l2 12M17 18l-7 2-2-4M17 18l7 4 4-4M18 28l-8 6-2 8M18 28l6 6 2 8"/></g>`,
        `<g transform="translate(96,0)"><circle cx="16" cy="10" r="5" fill="white"/><path d="M16 15v12M16 17l-2 7v6M16 17l2 7v6M16 27l0 9-2 8M16 27l2 6 6 5"/></g>`,
        `<g transform="translate(128,0)"><circle cx="16" cy="11" r="5" fill="white"/><path d="M16 16l-2 12M15 18l7 2 2-4M15 18l-7 4-4-4M14 28l8 6 2 8M14 28l-6 6-2 8"/></g>`,
        `<g transform="translate(160,0)"><circle cx="16" cy="10" r="5" fill="white"/><path d="M16 15v12M16 17l-2 7v6M16 17l2 7v6M16 27l0 9 2 8M16 27l-2 6-6 5"/></g>`,
        `<g transform="translate(192,0)"><circle cx="16" cy="10" r="5" fill="white"/><path d="M16 15v12M16 17l-6-3-4-6M16 17l6-3 4-6M16 27l-6 0-2 9M16 27l6 0 2 9"/></g>`
    ];
    const newIdle = `<g transform="translate(224,0)"><circle cx="16" cy="12" r="5" fill="white"/><path d="M16 17v11M16 18l-4 6-2 6M16 18l4 6 2 6M16 28l-4 8v8M16 28l4 8v8"/></g>`;
    const fall = `<g transform="translate(256,0)"><circle cx="16" cy="14" r="5" fill="white"/><path d="M16 19v10M16 20l-9 3-2-4M16 20l9 3 2-4M16 30l-5 9v7M16 30l5 9v7"/></g>`;
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="288" height="48"><g stroke="white" stroke-width="3" stroke-linecap="round" fill="none">${[...origFrames, newIdle, fall].join("")}</g></svg>`;
}

loadSprite("player", generateStickmanSVG(), { sliceX: 9, anims: { idle: { from: 0, to: 2, loop: true, speed: 3 }, run: { from: 3, to: 6, loop: true, speed: 14 }, jump: { from: 7, to: 7, loop: false, speed: 1 }, fall: { from: 8, to: 8, loop: false, speed: 1 } } });
loadSprite("e_nrm", `data:image/svg+xml;utf8,<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="14" fill="white"/><circle cx="11" cy="12" r="3" fill="black"/><circle cx="21" cy="12" r="3" fill="black"/></svg>`);
loadSprite("e_bnc", `data:image/svg+xml;utf8,<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="14" fill="%23ddd"/><circle cx="16" cy="16" r="10" fill="white"/><circle cx="11" cy="12" r="2" fill="black"/><circle cx="21" cy="12" r="2" fill="black"/></svg>`);
loadSprite("e_jmp", `data:image/svg+xml;utf8,<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg"><path d="M 4 28 C 4 10, 28 10, 28 28 Z" fill="white"/><circle cx="16" cy="14" r="6" fill="black"/><circle cx="16" cy="14" r="2" fill="white"/></svg>`);
loadSprite("e_fly", `data:image/svg+xml;utf8,<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="10" fill="white"/><path d="M0 10l10 6L0 22M32 10l-10 6 10 6" fill="%23ccc"/><circle cx="13" cy="14" r="2" fill="black"/><circle cx="19" cy="14" r="2" fill="black"/></svg>`);
loadSprite("block", `data:image/svg+xml;utf8,<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" fill="white"/><rect width="40" height="10" fill="%23ddd"/></svg>`);
loadSprite("spike", `data:image/svg+xml;utf8,<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg"><path d="M20 10L40 40H0z" fill="%23f33"/></svg>`);
loadSprite("bullet", `data:image/svg+xml;utf8,<svg width="16" height="8" xmlns="http://www.w3.org/2000/svg"><rect width="16" height="8" rx="4" fill="%230f0"/></svg>`);
loadSprite("coin", `data:image/svg+xml;utf8,<svg width="24" height="24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="%23fd0"/></svg>`);
loadSprite("pistol", `data:image/svg+xml;utf8,<svg width="24" height="16" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="20" height="6" fill="%23aaa"/></svg>`);
loadSprite("heart", `data:image/svg+xml;utf8,<svg width="24" height="24" xmlns="http://www.w3.org/2000/svg"><path d="M12 21.3l-1.4-1.3C5.4 15.3 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.7 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.8-8.5 11.5L12 21.3z" fill="red"/></svg>`);
loadSprite("flag", `data:image/svg+xml;utf8,<svg width="40" height="80" xmlns="http://www.w3.org/2000/svg"><rect x="18" y="10" width="4" height="70" fill="white"/><path d="M22 10l18 10-18 10z" fill="%230f0"/></svg>`);
loadSprite("mask", `data:image/svg+xml;utf8,<svg width="2000" height="2000" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="g"><stop offset="0%" stop-color="black" stop-opacity="0"/><stop offset="30%" stop-color="black" stop-opacity="0.95"/><stop offset="100%" stop-color="black" stop-opacity="1"/></radialGradient></defs><rect width="2000" height="2000" fill="url(%23g)"/></svg>`);
loadSprite("prx_far", `data:image/svg+xml;utf8,<svg width="400" height="200" xmlns="http://www.w3.org/2000/svg"><path d="M0 200l200-150 200 150z" fill="white" opacity="0.12"/></svg>`);
loadSprite("prx_near", `data:image/svg+xml;utf8,<svg width="400" height="200" xmlns="http://www.w3.org/2000/svg"><path d="M0 200l100-80 100 80 100-60 100 60z" fill="white" opacity="0.18"/></svg>`);
loadSprite("cloud", `data:image/svg+xml;utf8,<svg width="120" height="60" xmlns="http://www.w3.org/2000/svg"><ellipse cx="40" cy="35" rx="30" ry="20" fill="white" opacity="0.15"/><ellipse cx="70" cy="25" rx="35" ry="22" fill="white" opacity="0.15"/><ellipse cx="55" cy="40" rx="25" ry="15" fill="white" opacity="0.12"/></svg>`);
loadSprite("mount", `data:image/svg+xml;utf8,<svg width="300" height="200" xmlns="http://www.w3.org/2000/svg"><polygon points="0,200 80,40 160,200" fill="white" opacity="0.08"/><polygon points="100,200 220,20 300,200" fill="white" opacity="0.06"/></svg>`);

const debugPanel = document.getElementById("debug-panel-game");
let debugVisible = false;

const cheatMap = { "+":0,"1":0,"ě":1,"2":1,"š":2,"3":2,"č":3,"4":3,"ř":4,"5":4,"ž":5,"6":5,"ý":6,"7":6,"á":7,"8":7,"í":8,"9":8,"é":"v","0":"v" };
let cheatBuf = [];
onCharInput((k) => {
    if (k in cheatMap) {
        cheatBuf.push(k); if (cheatBuf.length > 6) cheatBuf.shift();
        if (cheatBuf.length === 6 && cheatBuf.every(v => v === k)) {
            const t = cheatMap[k]; cheatBuf = [];
            if (t === "v") {
                if (typeof window.broadcastLevelComplete === 'function') window.broadcastLevelComplete(9999);
                go("victory", 9999);
            } else {
                if (typeof window.broadcastLevelComplete === 'function') window.broadcastLevelComplete(t);
                go("game", t, 6, 25, 0);
            }
        }
    } else cheatBuf = [];
});

window.triggerHttpBlock = () => {
    addToast("Připojeno přes HTTP Relay - mohou nastat lagy!");
};

scene("game", (lvlIdx = 0, hp = 6, ammo = 25, score = 0) => {
    initAudio();
    const lvl = LVL[lvlIdx];
    
    if (!lvl) {
        go("victory", score);
        return;
    }

    setBackground(lvl.bg[0], lvl.bg[1], lvl.bg[2]);
    document.getElementById('game-wrapper').style.backgroundColor = `rgb(${lvl.bg.join(',')})`; 
    setGravity(lvl.g);

    let maxHp = Math.max(6, hp);
    let playerDead = false; 
    let screenShake = 0; 
    let wasGrounded = true; 
    let coyoteTime = 0; 
    let jumpBuffer = 0;
    
    let myKills = 0;
    let myDeaths = 0;
    let playerStats = {}; 
    
    const MAP_W = lvl.m[0].length * 40; 
    const MAP_H = lvl.m.length * 40;

    const bgFar = add([fixed(), pos(0,0), z(-25), "parallax_far"]); 
    const bgNear = add([fixed(), pos(0,0), z(-15), "parallax_near"]);
    
    for (let i=0; i<6; i++) { 
        bgFar.add([sprite("cloud"), pos(i*200+rand(-50,50), rand(10,120)), opacity(0.7)]); 
        bgFar.add([sprite("mount"), pos(i*350+rand(-80,80), height()-180), opacity(0.5)]); 
    }
    for (let i=0; i<10; i++) { 
        bgNear.add([sprite("prx_near"), pos(i*200, height()-160), color(lvl.th[0],lvl.th[1],lvl.th[2]), opacity(0.4)]); 
    }
    if (lvl.isSpc) {
        for (let i=0; i<80; i++) bgFar.add([rect(2,2), color(255,255,255), opacity(rand(0.3,0.9)), pos(rand(0,MAP_W), rand(0,MAP_H)), "star"]);
    }
    if (lvlIdx === 6) { 
        const rainLayer = add([fixed(), z(-5)]); 
        for (let i=0; i<40; i++) rainLayer.add([rect(2,rand(8,16)), color(180,200,255), opacity(0.4), pos(rand(0,1000), rand(-200,0)), move(DOWN, rand(200,400)), "rain"]); 
    }

    let light; 
    if (lvl.isD) light = add([sprite("mask"), pos(0,0), anchor("center"), z(90), scale(2.5)]); 

    const ec = lvl.ec;
    let coinIdx = 0, pistolIdx = 0, healIdx = 0;

    addLevel(lvl.m, {
        tileWidth:40, tileHeight:40,
        tiles: {
            "=": () => [sprite("block"), color(lvl.th[0],lvl.th[1],lvl.th[2]), area(), body({isStatic:true}), anchor("center"), "ground", "solid", { update(){ this.color = this.isGrounded ? rgb(lvl.tt[0],lvl.tt[1],lvl.tt[2]) : rgb(lvl.th[0],lvl.th[1],lvl.th[2]); } }],
            "^": () => [sprite("spike"), area({shape: new Polygon([vec2(0,15),vec2(20,-15),vec2(-20,-15)])}), body({isStatic:true}), anchor("center"), "danger", "solid"],
            "F": () => [sprite("flag"), area(), anchor("center"), "finish"],
            "$": () => [sprite("coin"), area(), anchor("center"), "coin", "loot", { lId: `c_${lvlIdx}_${coinIdx++}` }],
            "P": () => [sprite("pistol"), area(), anchor("center"), "pistol", "loot", { lId: `p_${lvlIdx}_${pistolIdx++}` }],
            "+": () => [sprite("heart"), area(), anchor("center"), "heal", "loot", { lId: `h_${lvlIdx}_${healIdx++}` }],
            
            "1": () => [sprite("e_nrm"), color(ec[0],ec[1],ec[2]), scale(1.4), area(), body(), anchor("center"), "enemy", "danger", { hp:2, type:"nrm", speed:80, stunTimer:0 }],
            "3": () => [sprite("e_jmp"), color(ec[0],ec[1],ec[2]), scale(1.4), area(), body(), anchor("center"), "enemy", "danger", { hp:4, type:"jmp", speed:100, jTmr:rand(1,3), stunTimer:0 }],
            "2": () => [sprite("e_bnc"), color(ec[0],ec[1],ec[2]), scale(1.7), area(), body(), anchor("center"), "enemy", "pusher", { hp:5, type:"bnc", speed:120, stunTimer:0 }],
            "B": () => [sprite("e_fly"), color(ec[0],ec[1],ec[2]), scale(1.4), area(), anchor("center"), "enemy", "danger", { hp:3, type:"fly", speed:70, dir:1, baseY:null, stunTimer:0 }],
            "!": () => [sprite("spike"), color(150,150,150), area(), anchor("center"), "fake", "solid"],
            "W": () => [sprite("block"), color(lvl.tt[0],lvl.tt[1],lvl.tt[2]), area(), body({isStatic:true}), anchor("center"), "breakable", "solid"],
            "X": () => [sprite("e_bnc"), color(255,50,50), scale(3.0), area(), body(), anchor("center"), "enemy", "danger", "boss", { hp:25, maxHp:25, type:"bnc", speed:150, stunTimer:0 }],
        }
    });

    let eIdx = 0; get("enemy").forEach(e => { e.eId = `e_${lvlIdx}_${eIdx++}`; e.use(e.eId); });
    get("loot").forEach(l => l.use(l.lId));

    function spawnDust(p) { 
        for(let i=0; i<6; i++) add([ rect(4,4), pos(p.x + rand(-10,10), p.y), color(200,200,200), move(vec2(rand(-1,1), rand(-0.1,-1)), rand(20,60)), opacity(0.8), lifespan(0.3, {fade: 0.3}), z(50) ]); 
    }
    function spawnBlood(p, count=6) { 
        for(let i=0; i<count; i++) add([ rect(rand(4,8), rand(4,8)), pos(p), color(255, 0, 0), move(vec2(rand(-1,1), rand(-1,1)), rand(100, 300)), opacity(0.9), lifespan(0.3, {fade: 0.3}), z(50) ]); 
    }
    function spawnKillSplash(p) { 
        playSound(100, 'sawtooth', 0.1, 0.2); 
        for (let i = 0; i < 4; i++) add([ circle(rand(20, 40)), pos(p.add(rand(-15, 15), rand(-10, 10))), color(255, 0, 0), opacity(0.8), anchor("center"), z(50), lifespan(0.25, {fade: 0.15}), "splash" ]); 
    }
    function doShake(intensity) { screenShake = Math.max(screenShake, intensity); }

    const localId = typeof window.chat_myId !== 'undefined' ? window.chat_myId : 'local';
    const playerColor = getPlayerColor(localId); 
    
    const player = add([ 
        sprite("player"), pos(80, MAP_H - 120), color(playerColor), 
        area({ width: 20, height: 38 }), body(), anchor("center"), 
        "player", { stun: false, cVel: 0 } 
    ]);
    player.play("idle");
    player.add([
        text(localId.substring(0,6), {size: 10}),
        pos(0, -30),
        anchor("center"),
        color(255,255,255)
    ]);

    get("enemy").forEach(e => { if (e.type === "fly" && e.pos) e.baseY = e.pos.y; });

    const ui = add([fixed(), z(100)]);
    ui.add([sprite("coin"), pos(20,22)]);
    
    const scoreLabel = ui.add([
        text(`Score: ${score}`, {size:20}), 
        pos(50,20),
        area(), "score_label"
    ]);
    
    const statsLabel = ui.add([
        text("", {size: 14, font: "monospace", align: "right"}),
        pos(width() - 10, 50),
        anchor("topright"),
        color(255, 255, 255)
    ]);
    
    loop(0.5, () => {
        const myName = localStorage.getItem('chat_nickname') || localId;
        playerStats[localId] = { name: myName, hp: hp, score: score, kills: myKills, deaths: myDeaths };
        let txt = "HRÁČI A STATY:\n";
        for (let id in playerStats) {
            let st = playerStats[id];
            txt += `${st.name.substring(0,10)} | HP:${st.hp} Sc:${st.score} K:${st.kills||0} D:${st.deaths||0}\n`;
        }
        statsLabel.text = txt;
    });

    ui.add([sprite("pistol"), pos(200,22), scale(1.4)]);
    const ammoLabel = ui.add([text(`x ${ammo}`, {size:20}), pos(235,20)]);
    
    const lvlIndicator = ui.add([
        text(`Level ${lvlIdx+1}/${LVL.length}`, {size:20}), pos(width()/2, 20), anchor("center"), area(), "lvl_indicator"
    ]);

    let tripleCharge = 0;
    let jumps = 0;

    const chargeBg = ui.add([rect(150, 10, {radius: 5}), pos(width()/2, 50), color(50,50,50), anchor("center")]);
    const chargeFg = ui.add([rect(0, 10, {radius: 5}), pos(width()/2 - 75, 50), color(0,255,255), anchor("left")]);
    const chargeTxt = ui.add([text("TROJSKOK", {size: 10}), pos(width()/2, 50), anchor("center"), color(255,255,255)]);

    const updateHP = () => {
        destroyAll("ui_hp");
        
        for (let i=0; i<maxHp; i++) {
            const heartPos = vec2(width() - 40 - i*35, 20);
            ui.add([sprite("heart"), pos(heartPos), color(0,0,0), opacity(0.25), "ui_hp"]);
            
            if (i < hp) {
                ui.add([sprite("heart"), pos(heartPos), "ui_hp"]);
            }
        }
    };
    updateHP();

    let bossBarBg, bossBarFg, bossText;
    if (lvl.isBoss) {
        const bossUI = add([fixed(), z(100)]);
        bossBarBg = bossUI.add([rect(400, 16), pos(width()/2 - 200, height() - 30), color(50,50,50)]);
        bossBarFg = bossUI.add([rect(396, 12), pos(width()/2 - 198, height() - 28), color(255,50,50)]);
        bossText = bossUI.add([text("BOSS", {size: 16}), pos(width()/2, height() - 45), anchor("center")]);
        
        onUpdate(() => { 
            const bosses = get("boss"); 
            if (bosses.length > 0) { 
                bossBarFg.width = 396 * (Math.max(0, bosses[0].hp) / bosses[0].maxHp); 
            } else { 
                bossBarBg.opacity = 0; bossBarFg.opacity = 0; bossText.opacity = 0; 
            } 
        });
    }

    const SPEED = 320; 
    const JUMP_FORCE = lvl.g < 1000 ? 420 : 680;

    function performJump(force) { 
        const bonus = Math.abs(player.cVel) > 50 ? (lvl.g < 1000 ? 30 : 80) : 0; 
        player.jump(force + bonus); 
        vibrate(10);
        spawnDust(player.pos.add(0, 15)); 
    }

    const doJump = () => { 
        if (!player.exists() || player.stun || playerDead) return; 
        jumpBuffer = 0.15; 
        if (coyoteTime > 0 || jumps === 0) {
            performJump(JUMP_FORCE);
            jumps = 1; coyoteTime = 0; jumpBuffer = 0;
            playSound(400, 'sine', 0.2, 0.05);
        } else if (jumps === 1) {
            performJump(JUMP_FORCE * 0.85);
            jumps = 2; jumpBuffer = 0;
            playSound(600, 'sine', 0.2, 0.05);
        } else if (jumps === 2 && tripleCharge >= 10) {
            performJump(JUMP_FORCE * 1.15);
            jumps = 3; jumpBuffer = 0; tripleCharge = 0;
            playSound(800, 'square', 0.2, 0.1);
            addToast("TROJSKOK BOOST!");
        }
    };
    
    const doShoot = () => { 
        if (!player.exists() || player.stun || ammo <= 0 || playerDead) return; 
        ammo--; 
        ammoLabel.text = `x ${ammo}`; 
        playSound(600, 'square', 0.1, 0.05); 
        vibrate(15);
        let dir = player.flipX ? LEFT : RIGHT;
        let spawnPos = vec2(player.pos.x+(player.flipX?-20:20), player.pos.y);
        add([sprite("bullet"), pos(spawnPos), area(), anchor("center"), move(dir, 1000), offscreen({destroy:true}), "bullet", { owner: localId }]); 

        if (typeof window.broadcastGameShoot === 'function') {
            window.broadcastGameShoot({ x: spawnPos.x, y: spawnPos.y, dirX: dir.x, dirY: dir.y, lvl: lvlIdx });
        }
    };

    window.doJump = doJump;
    window.doShoot = doShoot;

    onKeyPress("up", doJump); 
    onKeyPress("space", doShoot); 
    onKeyPress("w", doJump);

    window.handleGameSync = (senderId, data) => {
        if (data.lvl !== lvlIdx) return;
        if (!window.chat_knownNodes || (!window.chat_knownNodes[senderId] && senderId !== localId)) return;

        playerStats[senderId] = { name: data.name || senderId, hp: data.hp || 0, score: data.score || 0, kills: data.kills || 0, deaths: data.deaths || 0 };
        
        let rp = get(senderId)[0];
        if (!rp) {
            rp = add([
                sprite("player"),
                pos(data.x, data.y),
                color(getPlayerColor(senderId)),
                area({ width: 20, height: 38 }),
                anchor("center"),
                "remote_player",
                senderId,
                { id: senderId }
            ]);
            rp.add([
                text(senderId.substring(0,6), {size: 10}),
                pos(0, -30),
                anchor("center"),
                color(255,255,255)
            ]);
        } else {
            rp.targetPos = vec2(data.x, data.y);
            rp.flipX = data.flipX;
            if (rp.curAnim() !== data.anim) rp.play(data.anim);
        }
    };

    onUpdate("remote_player", (rp) => {
        if (rp.targetPos) {
            if (rp.pos.dist(rp.targetPos) > 200) {
                rp.pos = rp.targetPos.clone();
            } else {
                rp.pos.x = lerp(rp.pos.x, rp.targetPos.x, 25 * dt()); 
                rp.pos.y = lerp(rp.pos.y, rp.targetPos.y, 25 * dt());
            }
        }
    });

    window.handleGameShoot = (senderId, data) => {
        if (data.lvl !== lvlIdx) return;
        add([
            sprite("bullet"),
            pos(data.x, data.y),
            area(),
            anchor("center"),
            move(vec2(data.dirX, data.dirY), 1000),
            offscreen({destroy:true}),
            "bullet",
            { owner: senderId }
        ]);
    };

    window.handleEnemyHit = (eId, dmg) => {
        let en = get(eId)[0];
        if (en) {
            en.hp -= dmg;
            en.stunTimer = 0.2;
            if (en.hp <= 0) {
                const ep = en.pos.clone(); 
                destroy(en); 
                spawnBlood(ep, en.is("boss") ? 60 : 20); 
                doShake(en.is("boss") ? 15 : 3); 
                spawnKillSplash(ep);
            }
        }
    };

    window.handleEnemySync = (enemiesData) => {
        if (getIsHost()) return;
        const masterIds = new Set(enemiesData.map(ed => ed.id));
        get("enemy").forEach(e => {
            if (!masterIds.has(e.eId)) destroy(e);
        });
        enemiesData.forEach(ed => {
            const en = get(ed.id)[0];
            if (en) {
                en.targetPos = vec2(ed.x, ed.y);
                if (!en.pos || en.pos.dist(en.targetPos) > 150) en.pos = en.targetPos.clone();
                if (en.hp > ed.hp) en.stunTimer = 0.2;
                en.hp = Math.min(en.hp, ed.hp);
                en.flipX = ed.flipX;
            }
        });
    };

    window.handlePlayerHit = (targetId, shooterId, isFatal) => {
        if (isFatal && shooterId === localId) {
            myKills++;
            addToast("Zabil jsi hráče!");
            score += 50;
            scoreLabel.text = `Score: ${score}`;
        }
        if (targetId !== localId) {
            let rp = get(targetId)[0];
            if (rp) {
                rp.color = rgb(255,50,50);
                wait(0.3, () => { if(rp.exists()) rp.color = getPlayerColor(targetId); });
            }
        }
    };

    window.handleLevelComplete = (nextLvlIdx) => {
        if (playerDead) return;
        playerDead = true;
        if (nextLvlIdx < LVL.length) go("game", nextLvlIdx, hp, ammo, score);
        else go("victory", score);
    };

    window.handlePlayerLeft = (id) => {
        const rps = get(id);
        if (rps && rps.length > 0) destroy(rps[0]);
        if (playerStats[id]) delete playerStats[id];
    };

    window.handleLootPickup = (lId) => {
        const l = get(lId)[0];
        if (l) destroy(l);
    };
    
    window.handleLootSync = (activeLootIds) => {
        if (getIsHost()) return;
        const idSet = new Set(activeLootIds);
        get("loot").forEach(l => {
            if (!idSet.has(l.lId)) destroy(l);
        });
    };

    let lastSyncTime = 0;
    let lastMapSyncTime = 0;
    let camTarget = vec2(player.pos.x, player.pos.y);
    
    onUpdate(() => {
        if (!player.exists() || playerDead) return;

        if (tripleCharge < 10) {
            tripleCharge += dt();
            if (tripleCharge >= 10) {
                tripleCharge = 10;
                playSound(1000, 'sine', 0.1, 0.05);
            }
        }
        chargeFg.width = (tripleCharge / 10) * 150;
        chargeFg.color = tripleCharge >= 10 ? rgb(0,255,0) : rgb(0,255,255);

        let syncRate = (typeof window.isHttpRelayMode !== 'undefined' && window.isHttpRelayMode) ? 0.2 : 0.06;
        if (time() - lastSyncTime > syncRate) {
            lastSyncTime = time();
            if (typeof window.broadcastGameSync === 'function') {
                window.broadcastGameSync({
                    lvl: lvlIdx,
                    x: player.pos.x,
                    y: player.pos.y,
                    flipX: player.flipX,
                    anim: player.curAnim(),
                    hp: hp,
                    score: score,
                    kills: myKills,
                    deaths: myDeaths,
                    name: localStorage.getItem('chat_nickname') || localId
                });
            }
        }

        if (getIsHost() && time() - lastMapSyncTime > 0.1) {
            lastMapSyncTime = time();
            const enemiesData = get("enemy").map(e => ({
                id: e.eId, x: e.pos.x, y: e.pos.y, hp: e.hp, flipX: e.flipX || false
            }));
            if (typeof window.broadcastEnemySync === 'function') window.broadcastEnemySync(enemiesData);
            
            const lootData = get("loot").map(l => l.lId);
            if (typeof window.broadcastLootSync === 'function') window.broadcastLootSync(lootData);
        }
        
        if (light && player.pos) light.pos = player.pos;
        if (player.vel.y > 800) player.vel.y = 800;

        if (player.isGrounded()) { 
            coyoteTime = 0.15; jumps = 0; 
        } else { 
            coyoteTime -= dt(); 
        }
        
        if (jumpBuffer > 0) { 
            jumpBuffer -= dt(); 
            if (coyoteTime > 0) { 
                performJump(JUMP_FORCE); 
                jumpBuffer = 0; coyoteTime = 0; jumps = 1;
                playSound(400, 'sine', 0.2, 0.05); 
            } 
        }
        
        if (player.isGrounded() && !wasGrounded) { 
            spawnDust(player.pos.add(0, 15)); 
            playSound(200, 'triangle', 0.1, 0.03); 
        }
        wasGrounded = player.isGrounded();

        if (player.stun) {
            player.move(player.cVel, 0); 
            if (player.curAnim() !== "jump") player.play("jump");
        } else {
            let dir = (useTilt && tiltAccel !== 0) ? tiltAccel : 0;
            
            if ((window.ctrlState && window.ctrlState.left) || isKeyDown("left") || isKeyDown("a")) dir = -1;
            if ((window.ctrlState && window.ctrlState.right) || isKeyDown("right") || isKeyDown("d")) dir = 1;

            player.cVel = lerp(player.cVel, dir * SPEED, dt() * lvl.f); 
            player.move(player.cVel, 0);

            if (Math.abs(player.cVel) > 100) {
                const blurOpacity = 0.05 + ((Math.abs(player.cVel) - 100) / (SPEED - 100)) * 0.25;
                const spr = add([ 
                    sprite("player"), pos(player.pos.x + rand(-3,3), player.pos.y + rand(-2,2)), color(playerColor), 
                    opacity(blurOpacity), z(player.z - 1), anchor("center"), lifespan(0.15, {fade: 0.15}) 
                ]);
                spr.flipX = player.flipX;
            }
            
            if (dir !== 0) { 
                player.flipX = dir < 0; 
                if (player.isGrounded() && player.curAnim() !== "run") player.play("run"); 
            } else if (player.isGrounded() && player.curAnim() !== "idle") { 
                player.play("idle"); 
            }
        }

        if (!player.isGrounded()) { 
            if (player.vel.y < -50 && player.curAnim() !== "jump") player.play("jump"); 
            else if (player.vel.y > 50 && player.curAnim() !== "fall") player.play("fall"); 
        }
        
        player.pos.x = Math.max(20, Math.min(player.pos.x, MAP_W-20));
        
        if (player.pos.y > MAP_H+100 && !playerDead) { 
            playerDead = true; myDeaths++; go("lose", lvlIdx, score); 
        }

        camTarget = vec2(lerp(camTarget.x, player.pos.x, 0.08), lerp(camTarget.y, player.pos.y, 0.08));
        screenShake = lerp(screenShake, 0, 0.1); 
        camPos(camTarget.x + rand(-screenShake, screenShake), camTarget.y + rand(-screenShake, screenShake));
        
        const cx = camPos().x; 
        const cy = camPos().y; 
        bgFar.pos.x = -((cx-400)*0.15) % 800; 
        bgFar.pos.y = -((cy-240)*0.15); 
        bgNear.pos.x = -((cx-400)*0.35) % 800;
        bgNear.pos.y = -((cy-240)*0.35);

        if (debugVisible && Math.floor(time()*60)%10 === 0) {
            const remoteIdsStr = get("remote_player").map(rp => rp.id).join(', ');
            const enemyDbg = get("enemy").map(e => `${e.eId.split('_').pop()}:[${Math.round(e.pos.x)},${Math.round(e.pos.y)}]`).join(' ');
            const dbgTxt = `${TEXTS.debugTitle}\n${TEXTS.debugLevel(lvlIdx+1)}\n${TEXTS.debugHP(hp, maxHp)}\n` +
                           `${TEXTS.debugAmmo(ammo)}\n${TEXTS.debugScore(score)}\n${TEXTS.debugPos(player.pos.x, player.pos.y)}\n` +
                           `${TEXTS.debugVel(player.cVel)}\n${TEXTS.debugGround(player.isGrounded())}\n` +
                           `${TEXTS.debugStun(player.stun)}\n${TEXTS.debugGravity(lvl.g)}\n` +
                           `${TEXTS.debugEnemies(get("enemy").length)} -> ${enemyDbg}\n${TEXTS.debugCoins(get("coin").length)}\n` +
                           `${TEXTS.debugFPS(Math.round(1/dt()))}\n${TEXTS.debugTime(time())}\n` +
                           `Peers: ${remoteIdsStr}`;
            document.getElementById("debug-content").innerText = dbgTxt;
        }
    });

    onUpdate("enemy", (e) => {
        const isHost = getIsHost();

        if (!isHost) {
            e.gravityScale = 0;
            if (e.vel) { e.vel.x = 0; e.vel.y = 0; } 
            if (e.targetPos) {
                e.pos.x = lerp(e.pos.x, e.targetPos.x, 20 * dt());
                e.pos.y = lerp(e.pos.y, e.targetPos.y, 20 * dt());
            }
        } else {
            if (e.gravityScale === 0) e.gravityScale = 1;
        }

        if (e.stunTimer > 0) { 
            e.stunTimer -= dt(); e.color = rgb(255,100,100); 
            if (e.stunTimer <= 0) e.color = rgb(ec[0],ec[1],ec[2]); return; 
        }
        
        const bs = e.type==="bnc" ? (e.is("boss")?3.0:1.7) : 1.4; 
        e.scale = vec2(bs + Math.sin(time()*6)*0.06, bs - Math.sin(time()*6)*0.06);
        
        if (isHost) {
            if (e.type==="fly") { 
                if (e.baseY!==null) e.pos.y = e.baseY + Math.sin(time()*4)*70; 
                e.move(e.speed*e.dir,0); 
                e.flipX = e.dir < 0; 
            } else {
                e.move(e.speed,0);
                e.flipX = e.speed < 0; 
            }
            
            if (e.type==="jmp" && e.isGrounded()) { 
                e.jump(520); e.jTmr -= dt(); if (e.jTmr<=0) { e.jump(520); e.jTmr=rand(1.2,2.8); } 
            }
            if (e.type==="bnc") { 
                if (player.exists() && player.pos && Math.abs(player.pos.x-e.pos.x)<450) {
                    e.speed=lerp(e.speed,(player.pos.x<e.pos.x?-1:1)*(e.is("boss")?170:180),0.06); 
                }
                if (e.isGrounded()) { e.jump(680); e.scale=vec2(bs*1.15,bs*0.75); } 
            }
        }
    });

    onCollide("enemy","solid",(e,b,col)=>{ if (col && (col.isLeft()||col.isRight())) { if (e.type==="fly") e.dir=-e.dir; else e.speed*=-1; } });
    
    onCollide("bullet","breakable",(b,w)=>{ 
        destroy(b); destroy(w); 
        score+=10; scoreLabel.text=`Score: ${score}`; 
        spawnDust(w.pos); playSound(300, 'square', 0.1, 0.05); 
    });

    onCollide("bullet", "remote_player", (b, rp) => {
        if (b.owner === localId) {
            destroy(b);
            spawnBlood(rp.pos, 5);
        }
    });

    onCollide("bullet", "player", (b, p) => {
        if (b.owner !== localId) {
            destroy(b); spawnBlood(p.pos, 5);
            if(playerDead) return;
            
            hp--; updateHP(); 
            if(hp <= 0){ 
                myDeaths++;
                if (typeof window.broadcastPlayerHit === 'function') window.broadcastPlayerHit(localId, b.owner, true);
                
                vibrate(200);
                hp = 6; player.pos.x = 80; player.pos.y = MAP_H - 120; player.cVel = 0; updateHP(); 
                spawnKillSplash(player.pos); addToast("Zabil tě protihráč! Respawn."); 
            } else {
                p.stun = true; p.cVel = (p.pos.x < b.pos.x ? -1 : 1) * 400; p.jump(JUMP_FORCE * 0.7); p.color = rgb(255, 50, 50);
                vibrate([50, 50, 50]);
                playSound(150, 'sawtooth', 0.3, 0.1); doShake(10); 
                wait(0.5, () => { if(p.exists()){ p.stun = false; p.color = getPlayerColor(localId); } });
                
                if (typeof window.broadcastPlayerHit === 'function') window.broadcastPlayerHit(localId, b.owner, false);
            }
        }
    });
    
    onCollide("bullet","enemy",(b,e)=>{
        if (b.owner === localId) {
            destroy(b); spawnBlood(e.pos, 5); 
            e.hp--; playSound(150, 'sawtooth', 0.1, 0.05);
            
            if(e.hp <= 0){ 
                const ep = e.pos.clone(); destroy(e); 
                score += e.is("boss") ? 100 : 5; scoreLabel.text = `Score: ${score}`; 
                spawnBlood(ep, e.is("boss") ? 60 : 20); doShake(e.is("boss") ? 15 : 3); spawnKillSplash(ep);
            } else { 
                e.stunTimer = 0.2; 
            }
            if (typeof window.broadcastEnemyHit === 'function') window.broadcastEnemyHit(e.eId, 1);
        } else {
            destroy(b); spawnBlood(e.pos, 5); 
        }
    });

    onCollide("player","pusher",(p,e)=>{
        if(!p.pos||!e.pos||p.stun||e.stunTimer>0||playerDead) return;
        p.stun=true; p.cVel=(p.pos.x<e.pos.x?-1:1)*420; p.jump(lvl.g<1000?300:500); p.color=rgb(180,180,180);
        vibrate([50, 50, 50]);
        playSound(200, 'sawtooth', 0.2, 0.1); doShake(6); 
        wait(0.5,()=>{ if(p.exists()){ p.stun=false; p.color=getPlayerColor(localId); } });
    });
    
    onCollide("player","danger",(p,d)=>{
        if(!p.pos||p.stun||playerDead) return;
        hp--; updateHP(); 
        if(hp<=0){ 
            myDeaths++;
            vibrate(200);
            hp=6; player.pos.x=80; player.pos.y=MAP_H - 120; player.cVel=0; updateHP(); 
            spawnKillSplash(player.pos); addToast("Zemřel jsi! Respawn."); 
        } else {
            p.stun=true; p.cVel=(p.pos.x<d.pos.x?-1:1)*400; p.jump(JUMP_FORCE*0.7); p.color=rgb(255,50,50);
            vibrate([50, 50, 50]);
            playSound(150, 'sawtooth', 0.3, 0.1); doShake(10); 
            wait(0.5,()=>{ if(p.exists()){ p.stun=false; p.color=getPlayerColor(localId); } });
        }
    });
    
    onCollide("player","loot",(p,l)=>{ 
        if (l.is("coin")) {
            score++; scoreLabel.text=`Score: ${score}`; 
            add([sprite("coin"), pos(l.pos), scale(0.8), move(UP,50), opacity(0.9), lifespan(0.4,{fade:0.4})]); 
            vibrate(10);
            playSound(1200, 'sine', 0.1, 0.05); setTimeout(()=>playSound(1600, 'sine', 0.1, 0.05), 100); 
        }
        if (l.is("pistol")) {
            ammo+=5; ammoLabel.text=`x ${ammo}`; 
            vibrate(10);
            playSound(800, 'square', 0.1, 0.05); 
        }
        if (l.is("heal")) {
            hp++; if(hp>maxHp) maxHp=hp; updateHP(); 
            vibrate(10);
            playSound(900, 'sine', 0.3, 0.05); 
        }
        destroy(l);
        if (typeof window.broadcastLootPickup === 'function') window.broadcastLootPickup(l.lId);
    });
    
    onCollide("player","finish",()=>{ 
        if(!playerDead){ 
            playerDead=true; 
            if(typeof window.broadcastLevelComplete === 'function') window.broadcastLevelComplete(lvlIdx + 1);
            if (lvlIdx + 1 < LVL.length) go("game", lvlIdx + 1, hp, ammo, score);
            else go("victory", score); 
        } 
    });
});

scene("lose", (lvlIdx, sc) => {
    setBackground(30,10,10); 
    document.getElementById('game-wrapper').style.backgroundColor = `rgb(30,10,10)`;
    add([text(`ZEMŘEL JSI V LEVELU ${lvlIdx+1}!`, {size:32}), pos(width()/2, height()/2 - 40), color(255,100,100), anchor("center")]);
    add([text(`Score: ${sc}`, {size:24}), pos(width()/2, height()/2), anchor("center")]);
    add([text("Klepni, nebo stiskni Mezerník pro restart", {size:16}), pos(width()/2, height()/2 + 50), color(150,150,150), anchor("center")]);
    
    const restart = () => { initAudio(); go("game", lvlIdx, 6, 25, sc); };
    
    const kE = onKeyPress("enter", restart); 
    const kS = onKeyPress("space", restart); 
    const mM = onMousePress(restart); 
    const tS = onTouchStart(restart);
    
    onSceneLeave(() => { kE.cancel(); kS.cancel(); mM.cancel(); tS.cancel(); });
});

scene("victory", (sc) => {
    setBackground(80,140,255); 
    document.getElementById('game-wrapper').style.backgroundColor = `rgb(80,140,255)`;
    add([text("🏆 VÍTĚZSTVÍ! 🏆", {size:44}), pos(width()/2, 70), color(255,200,0), anchor("center")]); 
    add([text(`Konečné score: ${sc}`, {size:26}), pos(width()/2, 130), anchor("center")]);
    add([text("Díky za hraní!", {size:16}), pos(width()/2, 180), color(50,50,50), anchor("center")]);
    
    add([rect(width(),40), color(50,200,50), pos(0,height()-40), area(), body({isStatic:true}), anchor("botleft")]);
    
    const localId = typeof window.chat_myId !== 'undefined' ? window.chat_myId : 'local';
    const pCol = getPlayerColor(localId);
    add([sprite("player"), pos(400,height()-40), scale(1.4), color(pCol), anchor("bot")]).play("idle");
    
    LVL.forEach((l,i)=>{ 
        const xP = i<5?50+i*65:470+(i-5)*65; 
        const yP = i<5?height()-40:height()-80; 
        add([sprite("e_nrm"), color(l.ec[0],l.ec[1],l.ec[2]), scale(1.3), pos(xP,yP), anchor("bot"), "cheer"]); 
    });
    onUpdate("cheer",(e)=>{ e.scale.y = 1.3+Math.sin(time()*4+e.pos.x*0.01)*0.18; });
    
    const restart = () => { initAudio(); go("game", 0, 6, 25, 0); };
    
    const kE = onKeyPress("enter", restart); 
    const kS = onKeyPress("space", restart); 
    const mM = onMousePress(restart); 
    const tS = onTouchStart(restart);
    
    onSceneLeave(() => { kE.cancel(); kS.cancel(); mM.cancel(); tS.cancel(); });
});

// STARTER
window.startGameKaboom = () => {
    if (window.gameStarted) return;
    window.gameStarted = true;
    initAudio();
    go("game", 0, 6, 25, 0);
};

// Automaticky spustit, pokud bylo UI menu uz odkliknuto pres parametr
const setupScreen = document.getElementById('setup-screen');
if (setupScreen && setupScreen.style.display === 'none') {
    window.startGameKaboom();
}
