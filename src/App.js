import React, { useState, useRef, useCallback, useEffect } from "react";

/* ──────────────────────────────────────────────────────────────
   JEANIE — $10K Premium denim-fit recommender
   Design: Warm Light · Cormorant Garamond · Editorial luxury
   ────────────────────────────────────────────────────────────── */

// Shared site-key header for /api/claude — not real auth (it ships in this
// bundle, so it's readable via view-source), just raises the bar against
// naive bots hitting the endpoint directly without loading the page first.
const CLAUDE_HEADERS = {
  "Content-Type": "application/json",
  ...(process.env.REACT_APP_JEANIE_SITE_KEY ? { "X-Jeanie-Key": process.env.REACT_APP_JEANIE_SITE_KEY } : {}),
};

const T = {
  bg:        "#f7f4ef",
  surface:   "#ffffff",
  surfaceB:  "#f0ece4",
  glass:     "rgba(255,252,247,0.82)",
  glassH:    "rgba(255,253,249,0.94)",
  border:    "rgba(28,18,8,0.09)",
  borderH:   "rgba(28,18,8,0.22)",
  borderG:   "rgba(140,105,28,0.30)",
  ink:       "#18110a",
  inkSoft:   "#4a3828",
  mute:      "#8a7060",
  faint:     "#c0a888",
  accent:    "#9a7828",
  accentH:   "#c8a64b",
  accentGlow:"rgba(154,120,40,0.20)",
  red:       "#b8302c",
  redH:      "#d23a35",
  denim:     "#1f3556",
  denimDeep: "#0f1f3a",
};

const SHAPES_WOMEN = [
  { id:"Hourglass",         accent:"#b8922a", desc:"Balanced shoulders and hips with a defined waist.", tips:"High-rise wide-leg or bootcut. Avoid shapeless boyfriend cuts.",
    params:{ sh:22, bu:22, wa:13, hi:22, label:["Bust","Waist","Hip"], ratio:"1:0.6:1" } },
  { id:"Pear",              accent:"#a04040", desc:"Narrower shoulders, fuller hips and thighs.", tips:"Dark-wash straight leg or flare. Avoid tapered ankle cuts.",
    params:{ sh:16, bu:18, wa:16, hi:26, label:["Narrow Bust","Waist","Full Hip"], ratio:"0.7:0.7:1" } },
  { id:"Apple",             accent:"#3a6090", desc:"Fuller midsection, slimmer legs.", tips:"Mid-rise straight or slim-straight. Avoid low-rise and super-skinny.",
    params:{ sh:22, bu:24, wa:26, hi:20, label:["Bust","Full Waist","Hip"], ratio:"1:1.1:0.9" } },
  { id:"Rectangle",         accent:"#5a7a5a", desc:"Uniform width — athletic build.", tips:"Embellished pockets or flares add curves. Avoid stiff rigid fits.",
    params:{ sh:20, bu:20, wa:20, hi:20, label:["Bust","Waist","Hip"], ratio:"1:1:1" } },
  { id:"Inverted Triangle", accent:"#7a5a8a", desc:"Broad shoulders, narrower hips.", tips:"Wide-leg or flared styles balance silhouette. Avoid skinny fits.",
    params:{ sh:28, bu:26, wa:16, hi:16, label:["Full Bust","Waist","Hip"], ratio:"1:0.6:0.6" } },
];

const SHAPES_MEN = [
  { id:"Trapezoid",         accent:"#4a6a8a", desc:"Broad shoulders tapering to a narrower waist — classic athletic build.", tips:"Straight or slim-straight balances the frame. Avoid super-skinny cuts that over-exaggerate the taper.",
    params:{ sh:26, bu:22, wa:14, hi:18, label:["Chest","Waist","Hip"], ratio:"1:0.6:0.8" } },
  { id:"Rectangle",         accent:"#5a7a5a", desc:"Uniform width shoulders-to-hips — lean, straight build.", tips:"Straight or tapered adds shape. Avoid overly baggy fits that hide the frame.",
    params:{ sh:20, bu:20, wa:20, hi:20, label:["Chest","Waist","Hip"], ratio:"1:1:1" } },
  { id:"Triangle",          accent:"#a04040", desc:"Narrower shoulders, fuller waist and hips.", tips:"Straight-leg or bootcut balances proportions. Avoid skinny fits that emphasize the hips.",
    params:{ sh:16, bu:16, wa:18, hi:24, label:["Chest","Waist","Full Hip"], ratio:"0.7:0.8:1" } },
  { id:"Inverted Triangle", accent:"#7a5a8a", desc:"Broad shoulders and chest, narrower waist and hips.", tips:"Straight or relaxed-straight balances the upper body. Avoid tapered skinny fits.",
    params:{ sh:28, bu:26, wa:16, hi:16, label:["Full Chest","Waist","Hip"], ratio:"1:0.6:0.6" } },
  { id:"Oval",              accent:"#3a6090", desc:"Fuller midsection, slimmer legs.", tips:"Relaxed or straight mid-rise skims the waist. Avoid low-rise and skinny fits.",
    params:{ sh:20, bu:22, wa:26, hi:18, label:["Chest","Full Waist","Hip"], ratio:"1:1.1:0.9" } },
];

// Brand homepages only — see BRAND_URLS note in fetchBrands for why deep
// product/category links aren't used (they rot: wrong locale, 404s, bot-
// blocked verification). Shared by both the catalog below and fetchBrands.
const BRAND_HOMEPAGES = {
  "Levi's":              "https://www.levi.com",
  "Wrangler":            "https://www.wrangler.com",
  "Lee":                 "https://www.lee.com",
  "Gap":                 "https://www.gap.com",
  "Guess":               "https://www.guess.com",
  "Mavi":                "https://www.mavi.com",
  "Diesel":              "https://www.diesel.com",
  "7 For All Mankind":   "https://www.7forallmankind.com",
  "American Eagle":      "https://www.ae.com",
  "Abercrombie & Fitch": "https://www.abercrombie.com",
};
const BRAND_TIERS = {
  "7 For All Mankind": "Luxury", "Diesel": "Luxury",
  "Mavi": "Premium", "Guess": "Premium",
  "Levi's": "Mid-Range", "Gap": "Mid-Range", "American Eagle": "Mid-Range", "Abercrombie & Fitch": "Mid-Range",
  "Lee": "Budget", "Wrangler": "Budget",
};
const TIER_PRICE_RANGE = {
  Luxury: "$150–$350", Premium: "$80–$150", "Mid-Range": "$50–$120", Budget: "$30–$70",
};

// ── Curated product catalog ─────────────────────────────────────
// Real, long-established product lines per brand, tagged by which body-shape
// archetypes they suit. This is the ground truth Claude selects FROM in
// fetchBrands() — it never invents a brand, product name, tier, or URL; it
// only picks candidates from this list and writes the persuasive copy
// (tagline / bestFor / whyItWorks). Fixes the hallucinated-product-name
// problem at the source instead of just working around broken links.
const PRODUCT_CATALOG = [
  // ── Levi's ──
  { brand:"Levi's", productName:"501 Original", gender:"women", tags:["Rectangle","Apple"] },
  { brand:"Levi's", productName:"Ribcage Straight", gender:"women", tags:["Hourglass","Apple"] },
  { brand:"Levi's", productName:"'70s High Flare", gender:"women", tags:["Hourglass","Inverted Triangle","Pear"] },
  { brand:"Levi's", productName:"501 Original", gender:"men", tags:["Rectangle","Trapezoid"] },
  { brand:"Levi's", productName:"511 Slim", gender:"men", tags:["Trapezoid","Triangle"] },
  { brand:"Levi's", productName:"505 Regular", gender:"men", tags:["Oval","Rectangle"] },
  // ── Wrangler ──
  { brand:"Wrangler", productName:"Retro Mae Bootcut", gender:"women", tags:["Hourglass","Pear"] },
  { brand:"Wrangler", productName:"High Rise Trouser", gender:"women", tags:["Inverted Triangle","Rectangle"] },
  { brand:"Wrangler", productName:"Slim Bootcut", gender:"women", tags:["Pear","Apple"] },
  { brand:"Wrangler", productName:"Cowboy Cut", gender:"men", tags:["Trapezoid","Rectangle"] },
  { brand:"Wrangler", productName:"Retro Slim", gender:"men", tags:["Triangle","Trapezoid"] },
  { brand:"Wrangler", productName:"Authentics Relaxed", gender:"men", tags:["Oval","Inverted Triangle"] },
  // ── Lee ──
  { brand:"Lee", productName:"Legendary Bootcut", gender:"women", tags:["Hourglass","Pear"] },
  { brand:"Lee", productName:"Ultra Lux Comfort Straight", gender:"women", tags:["Apple","Rectangle"] },
  { brand:"Lee", productName:"Flex Motion Skinny", gender:"women", tags:["Rectangle","Hourglass"] },
  { brand:"Lee", productName:"Extreme Motion Straight", gender:"men", tags:["Oval","Rectangle"] },
  { brand:"Lee", productName:"Legendary Regular", gender:"men", tags:["Trapezoid","Rectangle"] },
  { brand:"Lee", productName:"Extreme Motion Slim", gender:"men", tags:["Triangle","Trapezoid"] },
  // ── Gap ──
  { brand:"Gap", productName:"'90s Loose", gender:"women", tags:["Rectangle","Inverted Triangle"] },
  { brand:"Gap", productName:"Vintage Straight", gender:"women", tags:["Apple","Rectangle"] },
  { brand:"Gap", productName:"Curvy High Rise", gender:"women", tags:["Pear","Hourglass"] },
  { brand:"Gap", productName:"Modern Athletic Taper", gender:"men", tags:["Trapezoid","Inverted Triangle"] },
  { brand:"Gap", productName:"Straight", gender:"men", tags:["Rectangle","Oval"] },
  { brand:"Gap", productName:"Slim", gender:"men", tags:["Triangle","Trapezoid"] },
  // ── Guess ──
  { brand:"Guess", productName:"Sexy Curve Skinny", gender:"women", tags:["Hourglass","Apple"] },
  { brand:"Guess", productName:"1981 Skinny", gender:"women", tags:["Rectangle","Apple"] },
  { brand:"Guess", productName:"Curve X Bootcut", gender:"women", tags:["Pear","Hourglass"] },
  { brand:"Guess", productName:"Slim Tapered", gender:"men", tags:["Trapezoid","Triangle"] },
  { brand:"Guess", productName:"Regular Straight", gender:"men", tags:["Rectangle","Oval"] },
  { brand:"Guess", productName:"Skinny", gender:"men", tags:["Trapezoid","Rectangle"] },
  // ── Mavi ──
  { brand:"Mavi", productName:"Kerry", gender:"women", tags:["Hourglass","Apple"] },
  { brand:"Mavi", productName:"Adriana", gender:"women", tags:["Rectangle","Apple"] },
  { brand:"Mavi", productName:"Sylvia Bootcut", gender:"women", tags:["Pear","Hourglass"] },
  { brand:"Mavi", productName:"Jake Slim", gender:"men", tags:["Trapezoid","Triangle"] },
  { brand:"Mavi", productName:"Marcus Slim Straight", gender:"men", tags:["Rectangle","Trapezoid"] },
  { brand:"Mavi", productName:"Zach Straight", gender:"men", tags:["Oval","Rectangle"] },
  // ── Diesel ──
  { brand:"Diesel", productName:"Slandy", gender:"women", tags:["Rectangle","Hourglass"] },
  { brand:"Diesel", productName:"D-Ollies Straight", gender:"women", tags:["Apple","Rectangle"] },
  { brand:"Diesel", productName:"D-Ejona Bootcut", gender:"women", tags:["Pear","Inverted Triangle"] },
  { brand:"Diesel", productName:"Larkee Relaxed", gender:"men", tags:["Oval","Inverted Triangle"] },
  { brand:"Diesel", productName:"Zatiny Bootcut", gender:"men", tags:["Triangle","Oval"] },
  { brand:"Diesel", productName:"D-Strukt Slim", gender:"men", tags:["Trapezoid","Triangle"] },
  // ── 7 For All Mankind ──
  { brand:"7 For All Mankind", productName:"Ellie Straight", gender:"women", tags:["Apple","Rectangle"] },
  { brand:"7 For All Mankind", productName:"The Skinny", gender:"women", tags:["Hourglass","Rectangle"] },
  { brand:"7 For All Mankind", productName:"Dojo Wide Leg", gender:"women", tags:["Inverted Triangle","Pear"] },
  { brand:"7 For All Mankind", productName:"Adrien Slim Taper", gender:"men", tags:["Trapezoid","Triangle"] },
  { brand:"7 For All Mankind", productName:"Slimmy", gender:"men", tags:["Rectangle","Trapezoid"] },
  { brand:"7 For All Mankind", productName:"Straight", gender:"men", tags:["Oval","Rectangle"] },
  // ── American Eagle ──
  { brand:"American Eagle", productName:"Curvy Straight", gender:"women", tags:["Pear","Hourglass"] },
  { brand:"American Eagle", productName:"Mom Jean", gender:"women", tags:["Rectangle","Apple"] },
  { brand:"American Eagle", productName:"'90s Boyfriend", gender:"women", tags:["Inverted Triangle","Rectangle"] },
  { brand:"American Eagle", productName:"AirFlex+ Slim", gender:"men", tags:["Trapezoid","Triangle"] },
  { brand:"American Eagle", productName:"Relaxed Straight", gender:"men", tags:["Oval","Inverted Triangle"] },
  { brand:"American Eagle", productName:"Original Straight", gender:"men", tags:["Rectangle","Oval"] },
  // ── Abercrombie & Fitch ──
  { brand:"Abercrombie & Fitch", productName:"Curve Love", gender:"women", tags:["Pear","Hourglass"] },
  { brand:"Abercrombie & Fitch", productName:"90s Straight Ultra High Rise", gender:"women", tags:["Apple","Rectangle"] },
  { brand:"Abercrombie & Fitch", productName:"Ultra High Rise Baggy", gender:"women", tags:["Inverted Triangle","Rectangle"] },
  { brand:"Abercrombie & Fitch", productName:"Athletic Skinny", gender:"men", tags:["Trapezoid","Triangle"] },
  { brand:"Abercrombie & Fitch", productName:"Slim Straight", gender:"men", tags:["Rectangle","Trapezoid"] },
  { brand:"Abercrombie & Fitch", productName:"Relaxed Taper", gender:"men", tags:["Oval","Inverted Triangle"] },
].map(p => ({ ...p, tier: BRAND_TIERS[p.brand], priceRange: TIER_PRICE_RANGE[BRAND_TIERS[p.brand]], url: BRAND_HOMEPAGES[p.brand] }));

/* ── Jeans style SVG paths (viewBox 0 0 60 120) ─────────── */
// Women's skinny — narrow fitted legs tapering to ankle
const JS = {
  skinny: {
    body: "M14,12 C13,26 11,40 10,52 L17,52 L19,120 L27,120 L27,52 Q30,54 33,52 L33,120 L41,120 L43,52 L50,52 C49,40 47,26 46,12 Z",
    waist:"M12,0 L48,0 L48,12 L12,12 Z",
    fly:  "M30,12 C30,24 30,38 30,52",
    lp:   "M15,13 C13,26 14,38 16,44",
    rp:   "M45,13 C47,26 46,38 44,44",
    ls:   "M19,54 L20,120", rs:"M41,54 L40,120",
    hip1: "M16,0 L16,12", hip2:"M44,0 L44,12",
  },
  // Women's wide-leg / palazzo — dramatic flare from hip
  wide: {
    body: "M16,12 C14,26 12,40 10,52 L2,52 L0,120 L28,120 L28,52 Q30,55 32,52 L32,120 L60,120 L58,52 L50,52 C48,40 46,26 44,12 Z",
    waist:"M14,0 L46,0 L46,12 L14,12 Z",
    fly:  "M30,12 C30,26 30,40 30,52",
    lp:   "M16,13 C14,28 15,40 18,46",
    rp:   "M44,13 C46,28 45,40 42,46",
    ls:   "M10,54 L4,120", rs:"M50,54 L56,120",
    hip1: "M18,0 L18,12", hip2:"M42,0 L42,12",
  },
  // Women's bootcut — fitted thigh, flares from knee
  bootcut: {
    body: "M12,12 C11,28 10,42 11,52 L16,52 L13,82 L8,120 L28,120 L30,82 L29,52 Q30,54 31,52 L30,82 L32,120 L52,120 L47,82 L44,52 L49,52 C50,42 49,28 48,12 Z",
    waist:"M10,0 L50,0 L50,12 L10,12 Z",
    fly:  "M30,12 C30,26 30,40 30,52",
    lp:   "M13,13 C11,28 12,42 15,48",
    rp:   "M47,13 C49,28 48,42 45,48",
    ls:   "M16,54 L11,82 L8,120", rs:"M44,54 L49,82 L52,120",
    hip1: "M15,0 L15,12", hip2:"M45,0 L45,12",
  },
  // Women's mom jeans — high-waist, relaxed hip/thigh, straight
  mom: {
    body: "M10,12 C9,26 9,42 10,52 L16,52 L17,120 L27,120 L27,52 Q30,56 33,52 L33,120 L43,120 L44,52 L50,52 C51,42 51,26 50,12 Z",
    waist:"M8,0 L52,0 L52,12 L8,12 Z",
    fly:  "M30,12 C30,26 30,40 30,52",
    lp:   "M12,13 C10,30 12,44 15,50",
    rp:   "M48,13 C50,30 48,44 45,50",
    ls:   "M17,54 L17,120", rs:"M43,54 L43,120",
    hip1: "M14,0 L14,12", hip2:"M46,0 L46,12",
  },
  // Men's straight leg — clean, uniform from hip to ankle
  straight: {
    body: "M8,12 C7,26 7,42 8,52 L14,52 L14,120 L27,120 L27,52 Q30,55 33,52 L33,120 L46,120 L46,52 L52,52 C53,42 53,26 52,12 Z",
    waist:"M6,0 L54,0 L54,12 L6,12 Z",
    fly:  "M30,12 C30,26 30,40 30,52",
    lp:   "M10,13 C8,28 9,42 13,48",
    rp:   "M50,13 C52,28 51,42 47,48",
    ls:   "M14,54 L14,120", rs:"M46,54 L46,120",
    hip1: "M12,0 L12,12", hip2:"M48,0 L48,12",
  },
  // Men's relaxed / baggy — wide through hip and leg
  baggy: {
    body: "M5,12 C4,24 3,38 4,52 L10,52 L10,120 L28,120 L28,52 Q30,56 32,52 L32,120 L50,120 L50,52 L56,52 C57,38 56,24 55,12 Z",
    waist:"M3,0 L57,0 L57,12 L3,12 Z",
    fly:  "M30,12 C30,26 30,40 30,52",
    lp:   "M7,13 C5,28 6,42 10,48",
    rp:   "M53,13 C55,28 54,42 50,48",
    ls:   "M10,54 L10,120", rs:"M50,54 L50,120",
    hip1: "M9,0 L9,12", hip2:"M51,0 L51,12",
  },
};

/* ── Jeans style SVG ─────────────────────────────────────── */
function JeansStyle({ style = "straight", size = 60, strokeColor = T.accent, strokeOpacity = 0.22 }) {
  const p = JS[style] || JS.straight;
  const s = strokeColor; const o = strokeOpacity; const sw = 1.2;
  return (
    <svg viewBox="0 0 60 120" width={size} height={size * 2} fill="none" aria-hidden>
      <path d={p.body}  stroke={s} strokeWidth={sw}   strokeOpacity={o}      fill={`${s}09`} fillOpacity={o*0.45}/>
      <path d={p.waist} stroke={s} strokeWidth={sw*1.1} strokeOpacity={o*1.2} fill={`${s}12`} fillOpacity={o*0.55}/>
      <path d={p.fly}   stroke={s} strokeWidth={0.8}  strokeOpacity={o*0.65} strokeDasharray="2,2"/>
      <path d={p.lp}    stroke={s} strokeWidth={0.75} strokeOpacity={o*0.75}/>
      <path d={p.rp}    stroke={s} strokeWidth={0.75} strokeOpacity={o*0.75}/>
      <path d={p.ls}    stroke={s} strokeWidth={0.65} strokeOpacity={o*0.5}  strokeDasharray="3,3"/>
      <path d={p.rs}    stroke={s} strokeWidth={0.65} strokeOpacity={o*0.5}  strokeDasharray="3,3"/>
      <path d={p.hip1}  stroke={s} strokeWidth={1.4}  strokeOpacity={o*1.1}  strokeLinecap="round"/>
      <path d={p.hip2}  stroke={s} strokeWidth={1.4}  strokeOpacity={o*1.1}  strokeLinecap="round"/>
      <path d="M22,0 L22,12" stroke={s} strokeWidth={1.4} strokeOpacity={o*0.85}/>
      <path d="M30,0 L30,12" stroke={s} strokeWidth={1.4} strokeOpacity={o*0.85}/>
      <path d="M38,0 L38,12" stroke={s} strokeWidth={1.4} strokeOpacity={o*0.85}/>
      <circle cx="14" cy="6" r="1.2" fill={s} fillOpacity={o*1.2}/>
      <circle cx="46" cy="6" r="1.2" fill={s} fillOpacity={o*1.2}/>
    </svg>
  );
}

/* ── Floating jeans background ───────────────────────────── */
function FloatingJeans() {
  const styles = ["skinny","wide","bootcut","mom","straight","baggy"];
  const colors = [T.denim, T.denimDeep, T.accent, "#4a6a8a", "#6a4a2a", T.denim];
  const instances = [
    // Women's styles — left/center column
    { x:"5%",  y:"2%",  size:70,  rot:-18, dur:22, delay:0,    drift:1, style:"skinny",   flip:false, op:0.50 },
    { x:"20%", y:"18%", size:52,  rot:12,  dur:19, delay:-7,   drift:3, style:"wide",     flip:true,  op:0.38 },
    { x:"2%",  y:"45%", size:90,  rot:-30, dur:28, delay:-13,  drift:2, style:"bootcut",  flip:false, op:0.45 },
    { x:"30%", y:"60%", size:58,  rot:8,   dur:21, delay:-4,   drift:4, style:"mom",      flip:true,  op:0.36 },
    { x:"12%", y:"80%", size:76,  rot:-14, dur:25, delay:-9,   drift:1, style:"wide",     flip:false, op:0.42 },
    // Men's styles — right column
    { x:"80%", y:"5%",  size:110, rot:20,  dur:30, delay:-5,   drift:2, style:"straight", flip:false, op:0.40 },
    { x:"92%", y:"28%", size:64,  rot:-25, dur:23, delay:-11,  drift:3, style:"baggy",    flip:true,  op:0.44 },
    { x:"72%", y:"48%", size:82,  rot:35,  dur:26, delay:-2,   drift:4, style:"straight", flip:true,  op:0.35 },
    { x:"88%", y:"68%", size:55,  rot:-8,  dur:18, delay:-15,  drift:1, style:"baggy",    flip:false, op:0.38 },
    { x:"65%", y:"82%", size:95,  rot:16,  dur:32, delay:-6,   drift:2, style:"skinny",   flip:false, op:0.42 },
    // Center fill
    { x:"45%", y:"8%",  size:48,  rot:-40, dur:17, delay:-8,   drift:3, style:"bootcut",  flip:false, op:0.28 },
    { x:"55%", y:"35%", size:120, rot:10,  dur:35, delay:-3,   drift:1, style:"wide",     flip:false, op:0.30 },
    { x:"38%", y:"55%", size:62,  rot:-22, dur:24, delay:-10,  drift:4, style:"mom",      flip:true,  op:0.34 },
    { x:"50%", y:"72%", size:44,  rot:48,  dur:16, delay:-18,  drift:2, style:"straight", flip:true,  op:0.26 },
    { x:"42%", y:"88%", size:86,  rot:-5,  dur:29, delay:-7,   drift:3, style:"baggy",    flip:false, op:0.40 },
    { x:"58%", y:"18%", size:68,  rot:28,  dur:20, delay:-14,  drift:4, style:"skinny",   flip:true,  op:0.32 },
  ];
  return (
    <div aria-hidden style={{ position:"fixed", inset:0, zIndex:0, pointerEvents:"none", overflow:"hidden" }}>
      {instances.map((inst, i) => (
        <div key={i} style={{
          position:"absolute", left:inst.x, top:inst.y,
          transform:`rotate(${inst.rot}deg) scaleX(${inst.flip ? -1 : 1})`,
          opacity:inst.op,
          animation:`jeansDrift${inst.drift} ${inst.dur}s ease-in-out ${inst.delay}s infinite`,
          willChange:"transform",
        }}>
          <JeansStyle style={inst.style} size={inst.size} strokeColor={colors[styles.indexOf(inst.style)]} strokeOpacity={0.30}/>
        </div>
      ))}
    </div>
  );
}

/* ── Tooltip ─────────────────────────────────────────────── */
function Tooltip({ children, content, placement = "top", maxWidth = 220 }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const ref = useRef();
  if (!content) return children;
  const handleEnter = (e) => {
    setShow(true);
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left + r.width / 2, y: placement === "top" ? r.top : r.bottom });
  };
  return (
    <span ref={ref} style={{ position:"relative", display:"inline-block" }}
      onMouseEnter={handleEnter} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <div style={{
          position:"absolute",
          bottom: placement === "top" ? "calc(100% + 10px)" : "auto",
          top: placement === "bottom" ? "calc(100% + 10px)" : "auto",
          left: "50%", transform:"translateX(-50%)",
          background:"rgba(24,17,10,0.94)",
          backdropFilter:"blur(16px)",
          color:"#d8cdb8",
          padding:"9px 14px", borderRadius:10, fontSize:12, lineHeight:1.55,
          maxWidth, whiteSpace: maxWidth > 160 ? "normal" : "nowrap",
          border:`1px solid rgba(200,166,75,0.18)`,
          zIndex:9000, pointerEvents:"none",
          boxShadow:"0 8px 32px rgba(0,0,0,0.2)",
          animation:"tooltipIn 0.15s cubic-bezier(.2,.7,.2,1)",
          textAlign:"center",
        }}>
          {content}
          <div style={{
            position:"absolute",
            bottom: placement === "top" ? -5 : "auto",
            top: placement === "bottom" ? -5 : "auto",
            left:"50%", transform:"translateX(-50%)",
            width:8, height:8, background:"rgba(24,17,10,0.94)",
            rotate: "45deg",
            border:`1px solid rgba(200,166,75,0.18)`,
            borderTop: placement === "top" ? "none" : undefined,
            borderLeft: placement === "top" ? "none" : undefined,
            borderBottom: placement === "bottom" ? "none" : undefined,
            borderRight: placement === "bottom" ? "none" : undefined,
          }}/>
        </div>
      )}
    </span>
  );
}

/* ── Scroll progress bar ─────────────────────────────────── */
function ScrollProgress() {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const h = () => {
      const d = document.documentElement;
      setPct(d.scrollHeight - d.clientHeight > 0 ? (window.scrollY / (d.scrollHeight - d.clientHeight)) * 100 : 0);
    };
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);
  return (
    <div aria-hidden style={{
      position:"fixed", top:0, left:0, zIndex:200,
      height:2, width:"100%",
      background:`linear-gradient(90deg, ${T.accent}, ${T.red}, ${T.accentH})`,
      transform:`scaleX(${pct / 100})`,
      transformOrigin:"left",
      transition:"transform 0.1s linear",
    }}/>
  );
}

/* ── Magnetic button wrapper ─────────────────────────────── */
function Magnetic({ children, strength = 0.14 }) {
  const ref = useRef();
  const handleMove = (e) => {
    const r = ref.current.getBoundingClientRect();
    const x = (e.clientX - r.left - r.width / 2) * strength;
    const y = (e.clientY - r.top - r.height / 2) * strength;
    ref.current.style.transform = `translate(${x}px, ${y}px)`;
  };
  const handleLeave = () => { ref.current.style.transform = ""; };
  return (
    <span ref={ref} onMouseMove={handleMove} onMouseLeave={handleLeave}
      style={{ display:"inline-block", transition:"transform 0.4s cubic-bezier(.2,.7,.2,1)" }}>
      {children}
    </span>
  );
}

/* ── Animated count-up ───────────────────────────────────── */
function CountUp({ to, dur = 1200 }) {
  const [val, setVal] = useState(0);
  const ref = useRef();
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      let start;
      const step = (t) => {
        if (!start) start = t;
        const p = Math.min(1, (t - start) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        setVal(Math.round(eased * to));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [to, dur]);
  return <span ref={ref}>{val}</span>;
}

/* ── Mobile breakpoint hook ──────────────────────────────── */
function useMobile(bp = 768) {
  const [mob, setMob] = useState(() => typeof window !== "undefined" && window.innerWidth < bp);
  useEffect(() => {
    const h = () => setMob(window.innerWidth < bp);
    window.addEventListener("resize", h, { passive:true });
    return () => window.removeEventListener("resize", h);
  }, [bp]);
  return mob;
}

/* ── Logo ─────────────────────────────────────────────────── */
function Logo({ size = 34 }) {
  return (
    <Tooltip content="Jeanie Fit·AI — denim intelligence powered by Claude Vision" maxWidth={230}>
      <span style={{ display:"inline-flex", alignItems:"baseline", gap:8, cursor:"default" }}>
        <span style={{ fontFamily:"'Cormorant Garamond',serif", fontWeight:600, fontStyle:"italic", fontSize:size, letterSpacing:"-0.04em", lineHeight:1, color:T.ink }}>jeanie</span>
        <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, fontWeight:500, letterSpacing:"0.22em", color:T.accent, textTransform:"uppercase", borderLeft:`1px solid ${T.border}`, paddingLeft:8 }}>Fit·AI</span>
      </span>
    </Tooltip>
  );
}

/* ── Glass card ──────────────────────────────────────────── */
function GlassCard({ children, style = {}, className = "", accent = false, glow = false }) {
  return (
    <div className={className} style={{
      background: T.glass,
      backdropFilter:"blur(24px) saturate(160%)",
      WebkitBackdropFilter:"blur(24px) saturate(160%)",
      border:`1px solid ${accent ? T.borderG : T.border}`,
      borderRadius:18,
      boxShadow: glow
        ? `0 0 40px -10px ${T.accentGlow}, 0 8px 32px -8px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.9)`
        : `0 4px 24px -4px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.8)`,
      ...style,
    }}>
      {children}
    </div>
  );
}

/* ── Denim texture background ────────────────────────────── */
function MeshBg() {
  return (
    <div aria-hidden style={{ position:"fixed", inset:0, zIndex:0, pointerEvents:"none", overflow:"hidden" }}>

      {/* ── Layer 1: Base warm-indigo wash ── */}
      <div style={{ position:"absolute", inset:0, background:"rgba(220,228,240,0.28)" }}/>

      {/* ── Layer 2: 3×1 twill weave pattern (classic denim) ── */}
      <svg width="100%" height="100%" style={{ position:"absolute", inset:0 }}>
        <defs>
          {/* Twill tile — 5×5px at -63° (denim's characteristic diagonal) */}
          <pattern id="denim-twill" x="0" y="0" width="5" height="5"
            patternUnits="userSpaceOnUse" patternTransform="rotate(-63 0 0)">
            {/* Row 0 — warp over */}
            <rect x="0" y="0" width="5" height="1.25" fill="rgba(32,58,98,0.20)"/>
            {/* Row 1 — warp over, shifted 1 unit */}
            <rect x="1.25" y="1.25" width="3.75" height="1.25" fill="rgba(32,58,98,0.18)"/>
            <rect x="0" y="1.25" width="1.25" height="1.25" fill="rgba(210,220,236,0.16)"/>
            {/* Row 2 — warp over, shifted 2 units */}
            <rect x="2.5" y="2.5" width="2.5" height="1.25" fill="rgba(32,58,98,0.16)"/>
            <rect x="0" y="2.5" width="2.5" height="1.25" fill="rgba(210,220,236,0.14)"/>
            {/* Row 3 — weft visible (the 1 in 3×1) */}
            <rect x="0" y="3.75" width="5" height="1.25" fill="rgba(220,230,245,0.22)"/>
          </pattern>

          {/* Fiber turbulence — irregular thread texture */}
          <filter id="denim-fiber" x="0%" y="0%" width="100%" height="100%"
            colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.80 1.40"
              numOctaves="5" seed="17" stitchTiles="stitch" result="noise"/>
            <feColorMatrix type="matrix"
              values="0 0 0 0 0.10  0 0 0 0 0.18  0 0 0 0 0.34  0 0 0 0.09 0"
              in="noise" result="tinted"/>
            <feComposite operator="in" in="tinted" in2="SourceGraphic"/>
          </filter>

          {/* Large-scale worn/faded variation */}
          <filter id="denim-worn" x="0%" y="0%" width="100%" height="100%"
            colorInterpolationFilters="sRGB">
            <feTurbulence type="turbulence" baseFrequency="0.006 0.009"
              numOctaves="3" seed="31" stitchTiles="stitch" result="macro"/>
            <feColorMatrix type="matrix"
              values="0 0 0 0 0.86  0 0 0 0 0.90  0 0 0 0 0.96  0 0 0 0.28 0"
              in="macro"/>
          </filter>
        </defs>

        {/* Twill weave */}
        <rect width="100%" height="100%" fill="url(#denim-twill)"/>
        {/* Fiber grain on top of weave */}
        <rect width="100%" height="100%" fill="rgba(247,244,239,1)" filter="url(#denim-fiber)" opacity="1"/>
        {/* Worn/faded macro variation */}
        <rect width="100%" height="100%" fill="rgba(230,236,248,1)" filter="url(#denim-worn)" opacity="0.22"/>
      </svg>

      {/* ── Layer 3: Subtle seam highlights (horizontal thread sheen) ── */}
      <div style={{
        position:"absolute", inset:0,
        backgroundImage:`
          repeating-linear-gradient(
            -63deg,
            transparent 0px,
            transparent 3.5px,
            rgba(235,242,252,0.07) 3.5px,
            rgba(235,242,252,0.07) 4px,
            transparent 4px,
            transparent 7.5px,
            rgba(200,215,235,0.05) 7.5px,
            rgba(200,215,235,0.05) 8px
          )
        `,
      }}/>

      {/* ── Layer 4: Ambient color orbs (depth + brand warmth) ── */}
      <div style={{
        position:"absolute", inset:"-20%",
        background:`
          radial-gradient(ellipse 55% 45% at 15% 10%, rgba(184,48,44,0.05), transparent 60%),
          radial-gradient(ellipse 65% 55% at 88% 20%, rgba(31,53,86,0.07), transparent 65%),
          radial-gradient(ellipse 60% 50% at 50% 100%, rgba(154,120,40,0.07), transparent 70%),
          radial-gradient(ellipse 40% 40% at 72% 60%, rgba(31,53,86,0.04), transparent 55%)
        `,
        filter:"blur(60px)",
      }}/>

      {/* ── Layer 5: Vignette — keeps edges warm, centre readable ── */}
      <div style={{
        position:"absolute", inset:0,
        background:`radial-gradient(ellipse 85% 85% at 50% 50%, transparent 42%, rgba(220,210,195,0.32) 100%)`,
      }}/>
    </div>
  );
}

/* ── Confidence ring ─────────────────────────────────────── */
function ConfidenceRing({ value = 75, size = 88 }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let raf, start;
    const step = (t) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / 900);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(value * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <Tooltip content="Match confidence — how closely your proportions align with this body archetype" maxWidth={240}>
      <div style={{ position:"relative", width:size, height:size, flexShrink:0, cursor:"default" }}>
        <svg width={size} height={size} style={{ transform:"rotate(-90deg)" }}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={T.border} strokeWidth="3"/>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={T.accent} strokeWidth="3"
            strokeDasharray={c} strokeDashoffset={c - (c * shown) / 100} strokeLinecap="round"
            style={{ filter:`drop-shadow(0 0 5px ${T.accentGlow})`, transition:"stroke-dashoffset 0.05s linear" }}/>
        </svg>
        <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column" }}>
          <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:22, fontWeight:600, color:T.ink, lineHeight:1 }}>{shown}<span style={{ fontSize:11, color:T.mute, marginLeft:2 }}>%</span></div>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:7, letterSpacing:"0.16em", color:T.mute, textTransform:"uppercase", marginTop:2 }}>match</div>
        </div>
      </div>
    </Tooltip>
  );
}

/* ── Fashion illustration body figure ────────────────────── */
/* ── Body shape silhouette icon ───────────────────────────── */
/* Literal object icons — each body shape rendered as the thing it's named after */
function ShapeIcon({ shapeId, accent, size = 48 }) {
  const uid = shapeId.replace(/\s/g,"");
  const gradId = `si-${uid}`;
  const gradDef = (
    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={accent} stopOpacity="0.95"/>
      <stop offset="100%" stopColor={accent} stopOpacity="0.45"/>
    </linearGradient>
  );

  if (shapeId === "Hourglass") {
    // An actual hourglass — two triangular bulbs pinched at the waist, with a frame and sand
    return (
      <svg viewBox="0 0 96 96" width={size} height={size} aria-hidden>
        <defs>{gradDef}</defs>
        <rect x="26" y="10" width="44" height="6" rx="2" fill={`url(#${gradId})`}/>
        <rect x="26" y="80" width="44" height="6" rx="2" fill={`url(#${gradId})`}/>
        <path d="M32,16 C32,34 46,42 48,48 C50,42 64,34 64,16 Z" fill={`url(#${gradId})`} opacity="0.9"/>
        <path d="M32,80 C32,62 46,54 48,48 C50,54 64,62 64,80 Z" fill={`url(#${gradId})`} opacity="0.9"/>
        <path d="M44,44 C46,46 50,46 52,44 L52,52 C50,50 46,50 44,52 Z" fill={accent} opacity="0.7"/>
      </svg>
    );
  }
  if (shapeId === "Pear") {
    // An actual pear — narrow top, rounded wide bottom
    return (
      <svg viewBox="0 0 96 96" width={size} height={size} aria-hidden>
        <defs>{gradDef}</defs>
        <path d="M46,10 C43,10 41,13 41,17 C41,20 43,22 44,24" fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" opacity="0.8"/>
        <ellipse cx="52" cy="20" rx="4" ry="5" fill={`url(#${gradId})`} opacity="0.85"/>
        <path d="M52,26 C40,30 34,42 34,54 C34,72 42,86 58,86 C74,86 80,70 78,54 C76,40 64,28 52,26 Z" fill={`url(#${gradId})`}/>
      </svg>
    );
  }
  if (shapeId === "Apple") {
    // An actual apple — round body, top dip, stem and leaf
    return (
      <svg viewBox="0 0 96 96" width={size} height={size} aria-hidden>
        <defs>{gradDef}</defs>
        <path d="M48,26 L48,18" stroke={accent} strokeWidth="3" strokeLinecap="round" opacity="0.8"/>
        <path d="M48,20 C52,14 60,16 58,22" fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" opacity="0.8"/>
        <path d="M48,28 C34,26 22,38 22,54 C22,72 32,86 48,86 C64,86 74,72 74,54 C74,38 62,26 48,28 Z" fill={`url(#${gradId})`}/>
        <path d="M48,30 C44,38 44,46 48,52 C52,46 52,38 48,30 Z" fill={accent} opacity="0.25"/>
      </svg>
    );
  }
  if (shapeId === "Rectangle") {
    // A literal rectangle
    return (
      <svg viewBox="0 0 96 96" width={size} height={size} aria-hidden>
        <defs>{gradDef}</defs>
        <rect x="30" y="14" width="36" height="68" rx="4" fill={`url(#${gradId})`}/>
        <rect x="30" y="14" width="36" height="68" rx="4" fill="none" stroke={accent} strokeWidth="1.5" opacity="0.4"/>
      </svg>
    );
  }
  if (shapeId === "Oval") {
    // An oval — rounded midsection, the men's-taxonomy equivalent of Apple
    return (
      <svg viewBox="0 0 96 96" width={size} height={size} aria-hidden>
        <defs>{gradDef}</defs>
        <ellipse cx="48" cy="50" rx="26" ry="34" fill={`url(#${gradId})`}/>
        <ellipse cx="48" cy="50" rx="26" ry="34" fill="none" stroke={accent} strokeWidth="1.5" opacity="0.4"/>
      </svg>
    );
  }
  if (shapeId === "Triangle") {
    // Point-up triangle — narrow shoulders, wide base at the hips
    return (
      <svg viewBox="0 0 96 96" width={size} height={size} aria-hidden>
        <defs>{gradDef}</defs>
        <path d="M48,12 C66,46 78,66 78,80 L18,80 C18,66 30,46 48,12 Z" fill={`url(#${gradId})`}/>
      </svg>
    );
  }
  if (shapeId === "Trapezoid") {
    // Wide at the top (shoulders), narrowing toward the base (waist/hips)
    return (
      <svg viewBox="0 0 96 96" width={size} height={size} aria-hidden>
        <defs>{gradDef}</defs>
        <path d="M14,16 L82,16 L64,80 L32,80 Z" fill={`url(#${gradId})`}/>
      </svg>
    );
  }
  // Inverted Triangle — point down triangle
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} aria-hidden>
      <defs>{gradDef}</defs>
      <path d="M18,16 L78,16 C78,16 66,50 48,84 C30,50 18,16 18,16 Z" fill={`url(#${gradId})`}/>
    </svg>
  );
}

/* ── Shape card — light editorial ─────────────────────────── */
function ShapeCard({ shape, active, index = 0 }) {
  const [hover, setHover] = useState(false);
  const lifted = hover || active;
  const acc = shape.accent || T.accent;
  const params = shape.params;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={`${shape.id} body shape${active ? " — your detected shape" : ""}: ${shape.desc}`}
      style={{
        position:"relative", borderRadius:22, overflow:"hidden", cursor:"default",
        aspectRatio:"2/3",
        background: active
          ? `linear-gradient(160deg, rgba(255,253,248,0.97) 0%, rgba(255,250,242,0.95) 60%)`
          : `linear-gradient(160deg, rgba(255,253,248,0.92) 0%, rgba(252,248,240,0.88) 60%)`,
        backdropFilter:"blur(20px) saturate(140%)",
        border:`1px solid ${active ? `${acc}55` : (hover ? `${acc}33` : "rgba(28,18,8,0.08)")}`,
        transform: lifted ? "translateY(-12px) scale(1.025)" : "translateY(0) scale(1)",
        boxShadow: lifted
          ? `0 32px 72px -16px rgba(28,18,8,0.18), 0 0 0 1px ${acc}33, 0 0 60px -20px ${acc}33`
          : "0 4px 24px -4px rgba(28,18,8,0.10)",
        transition:"transform 0.5s cubic-bezier(.2,.7,.2,1), box-shadow 0.5s, border-color 0.4s",
        zIndex: lifted ? 2 : 1,
      }}
    >
      {/* Accent top line */}
      <div aria-hidden style={{
        position:"absolute", top:0, left:0, right:0, height:2,
        background: lifted
          ? `linear-gradient(90deg, transparent, ${acc}, transparent)`
          : `linear-gradient(90deg, transparent, ${acc}55, transparent)`,
        transition:"background 0.4s",
      }}/>

      {/* Corner brackets */}
      <div aria-hidden style={{ position:"absolute", top:14, left:14, width:16, height:16, borderTop:`1px solid ${acc}`, borderLeft:`1px solid ${acc}`, opacity: lifted ? 0.7 : 0.2, transition:"opacity 0.3s" }}/>
      <div aria-hidden style={{ position:"absolute", bottom:90, right:14, width:16, height:16, borderBottom:`1px solid ${acc}`, borderRight:`1px solid ${acc}`, opacity: lifted ? 0.5 : 0.12, transition:"opacity 0.3s" }}/>

      {/* Index number watermark */}
      <div aria-hidden style={{
        position:"absolute", top:14, right:20,
        fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic",
        fontSize:56, fontWeight:600, lineHeight:1,
        color:`${acc}0d`,
        userSelect:"none",
      }}>{String(index+1).padStart(2,"0")}</div>

      {/* Active badge */}
      {active && (
        <div style={{
          position:"absolute", top:16, left:16, zIndex:3,
          padding:"5px 12px", borderRadius:999,
          background:`linear-gradient(135deg, ${acc}ee, ${acc}aa)`,
          color:"#fff",
          fontFamily:"'JetBrains Mono',monospace", fontSize:8, fontWeight:600,
          letterSpacing:"0.18em", textTransform:"uppercase",
          display:"flex", alignItems:"center", gap:6,
          boxShadow:`0 4px 20px ${acc}44`,
          animation:"fadeSlideUp 0.4s ease-out",
        }}>
          <span style={{ width:4, height:4, background:"rgba(255,255,255,0.9)", borderRadius:"50%", boxShadow:"0 0 6px rgba(255,255,255,0.8)" }}/>
          Your shape
        </div>
      )}

      {/* Shape silhouette icon — top-right */}
      <div aria-hidden style={{
        position:"absolute", top:lifted ? 18 : 16, right:lifted ? 18 : 16,
        opacity: lifted ? 0.85 : 0.30,
        transition:"opacity 0.4s, top 0.4s, right 0.4s",
        zIndex:2,
      }}>
        <ShapeIcon shapeId={shape.id} accent={acc} size={lifted ? 52 : 44}/>
      </div>

      {/* Figure stage */}
      <div style={{
        position:"absolute", top:0, left:0, right:0, bottom:92,
        display:"flex", alignItems:"center", justifyContent:"center",
        background: lifted
          ? `radial-gradient(ellipse 70% 50% at 50% 50%, ${acc}10, transparent 70%)`
          : "none",
        transition:"background 0.5s",
      }}>
        <div style={{ animation:`breathe 5s ease-in-out ${index * 0.35}s infinite`, filter:`drop-shadow(0 12px 32px ${lifted ? `${acc}55` : "rgba(0,0,0,0.18)"})`, transition:"filter 0.5s" }}>
          <ShapeIcon shapeId={shape.id} accent={acc} size={100}/>
        </div>
      </div>

      {/* Measurement ratio sidebar */}
      {lifted && (
        <div style={{
          position:"absolute", left:14, top:"50%", transform:"translateY(-50%)",
          display:"flex", flexDirection:"column", gap:14, zIndex:2,
          animation:"fadeSlideUp 0.35s ease-out",
        }}>
          {[
            { label:"B", val: params.bu * 2 },
            { label:"W", val: params.wa * 2 },
            { label:"H", val: params.hi * 2 },
          ].map(({ label, val }) => (
            <div key={label} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:7, color:acc, letterSpacing:"0.1em" }}>{label}</div>
              <div style={{ width:2, height: Math.round(val * 0.55), background:`linear-gradient(180deg, ${acc}99, ${acc}22)`, borderRadius:1 }}/>
            </div>
          ))}
        </div>
      )}

      {/* Card footer */}
      <div style={{
        position:"absolute", left:0, right:0, bottom:0,
        padding:"16px 18px 20px",
        background:"linear-gradient(0deg, rgba(255,252,245,0.98) 65%, transparent 100%)",
        borderTop:`1px solid rgba(28,18,8,0.07)`,
      }}>
        {/* Shape ratio tags */}
        <div style={{ display:"flex", gap:5, marginBottom:10 }}>
          {params.label.map((l,i) => (
            <span key={i} style={{
              fontFamily:"'JetBrains Mono',monospace", fontSize:7.5,
              letterSpacing:"0.10em", color:acc,
              padding:"2px 7px", borderRadius:999,
              border:`1px solid ${acc}44`,
              background:`${acc}12`,
              textTransform:"uppercase",
            }}>{l}</span>
          ))}
        </div>

        <div style={{
          fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic", fontWeight:600,
          fontSize:26, lineHeight:1, letterSpacing:"-0.02em",
          color: active ? acc : (hover ? T.ink : T.inkSoft),
          marginBottom: lifted ? 8 : 0,
          transition:"color 0.3s",
        }}>{shape.id}</div>

        <div style={{
          fontSize:11.5, fontWeight:400, lineHeight:1.55,
          color: T.mute,
          clipPath: lifted ? "inset(0 0 0% 0)" : "inset(0 0 100% 0)",
          opacity: lifted ? 1 : 0,
          transition:"clip-path 0.45s cubic-bezier(.2,.7,.2,1), opacity 0.35s",
        }}>{shape.desc}</div>

        {lifted && shape.tips && (
          <div style={{
            fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:acc,
            lineHeight:1.55, marginTop:8, letterSpacing:"0.03em",
            animation:"fadeSlideUp 0.35s 0.1s ease-out both",
          }}>{shape.tips}</div>
        )}
      </div>
    </div>
  );
}

/* ── Section heading ─────────────────────────────────────── */
function SectionHead({ eyebrow, title, n }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:52, gap:24 }}>
      <div>
        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.22em", color:T.accent, textTransform:"uppercase", marginBottom:14, display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ display:"inline-block", width:24, height:1, background:T.accent, opacity:0.5 }}/>
          {eyebrow}
        </div>
        <h2 style={{ fontFamily:"'Cormorant Garamond',serif", fontWeight:400, fontStyle:"italic", fontSize:"clamp(40px,5.5vw,72px)", lineHeight:0.96, letterSpacing:"-0.03em", color:T.ink, margin:0 }}>{title}</h2>
      </div>
      {n && <div style={{ fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic", fontSize:110, color:T.faint, opacity:0.14, lineHeight:0.85, userSelect:"none", flexShrink:0 }}>{n}</div>}
    </div>
  );
}

/* ── FadeIn on scroll ────────────────────────────────────── */
function FadeIn({ children, delay = 0, y = 28 }) {
  const ref = useRef();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); io.disconnect(); } }, { threshold:0.10 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} style={{
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : `translateY(${y}px)`,
      transition:`opacity 0.8s ${delay}s cubic-bezier(.2,.7,.2,1), transform 0.8s ${delay}s cubic-bezier(.2,.7,.2,1)`,
    }}>{children}</div>
  );
}

/* ── Marquee ticker ──────────────────────────────────────── */
function Marquee({ text, speed = 35 }) {
  const items = Array(6).fill(text);
  return (
    <div style={{ overflow:"hidden", display:"flex", whiteSpace:"nowrap" }} aria-hidden>
      <div style={{ display:"flex", gap:0, animation:`marquee ${speed}s linear infinite` }}>
        {[...items, ...items].map((t, i) => (
          <span key={i} style={{ fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic", fontSize:"clamp(15px,2vw,20px)", color:T.mute, letterSpacing:"0.06em", padding:"0 40px" }}>
            {t} <span style={{ color:T.accent, opacity:0.5 }}>·</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   App
   ────────────────────────────────────────────────────────────── */
export default function Jeanie() {
  const [preview,       setPreview]       = useState(null);
  const [imgB64,        setImgB64]        = useState(null);
  const [imgMime,       setImgMime]       = useState("image/jpeg");
  const [loading,       setLoading]       = useState(false);
  const [result,        setResult]        = useState(null);
  const [error,         setError]         = useState(null);
  const [dragOver,      setDragOver]      = useState(false);
  const [brands,        setBrands]        = useState(null);
  const [brandsLoading, setBrandsLoading] = useState(false);
  const [scrollY,       setScrollY]       = useState(0);
  const [navOpen,       setNavOpen]       = useState(false);
  const [scanProg,      setScanProg]      = useState(0);
  const [scanPhase,     setScanPhase]     = useState(0);
  const [scanDone,      setScanDone]      = useState(false);
  const [fitCategory,   setFitCategory]   = useState("women"); // "women" | "men" — drives shape taxonomy, labels, and AI prompts
  const pendingResult = useRef(null);
  const activeShapes = fitCategory === "men" ? SHAPES_MEN : SHAPES_WOMEN;
  const mob = useMobile();
  const fileRef = useRef();
  const cameraRef = useRef();

  useEffect(() => {
    const h = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", h, { passive:true });
    return () => window.removeEventListener("scroll", h);
  }, []);

  const SCAN_PHASES = [
    "INITIALIZING VISION MODEL",
    "MAPPING SKELETAL LANDMARKS",
    "COMPUTING SHOULDER RATIO",
    "ANALYZING WAIST DEFINITION",
    "CALCULATING HIP GEOMETRY",
    "CROSS-REFERENCING ARCHETYPES",
    "MATCHING DENIM DATABASE",
    "FINALIZING BODY PROFILE",
  ];

  useEffect(() => {
    if (!loading) { setScanProg(0); setScanPhase(0); setScanDone(false); return; }
    setScanProg(0); setScanPhase(0); setScanDone(false);
    const dur = 7800;
    const tick = 60;
    let elapsed = 0;
    const id = setInterval(() => {
      elapsed += tick;
      const p = Math.min(97, (elapsed / dur) * 100);
      setScanProg(p);
      setScanPhase(Math.min(SCAN_PHASES.length - 1, Math.floor((p / 100) * SCAN_PHASES.length)));
    }, tick);
    return () => clearInterval(id);
  }, [loading]); // eslint-disable-line

  useEffect(() => {
    if (!scanDone) return;
    // Rush bar to 100% then commit
    setScanProg(100);
    setScanPhase(SCAN_PHASES.length - 1);
    const t = setTimeout(() => {
      const p = pendingResult.current;
      if (p?.ok) {
        setResult(p.parsed);
        fetchBrands(p.parsed);
        setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior:"smooth", block:"start" }), 200);
      } else {
        setError(p?.err || "Analysis failed");
      }
      pendingResult.current = null;
      setLoading(false);
    }, 600);
    return () => clearTimeout(t);
  }, [scanDone]); // eslint-disable-line

  const fetchBrands = async (fitResult) => {
    setBrandsLoading(true); setBrands(null);
    try {
      // Ground truth first: filter the curated catalog to this gender + shape,
      // then hand Claude only those candidates. It can no longer invent a
      // brand, product name, tier, or URL — it can only pick from real data
      // and write the persuasive copy (tagline / bestFor / whyItWorks).
      const sameGender = PRODUCT_CATALOG.filter(p => p.gender === fitCategory);
      let candidates = sameGender.filter(p => p.tags.includes(fitResult.shape));
      if (candidates.length < 8) {
        // Pad with other entries for this gender so Claude still has enough
        // tier variety to choose a diverse 6 from.
        const rest = sameGender.filter(p => !candidates.includes(p));
        candidates = [...candidates, ...rest].slice(0, 14);
      }
      const candidateList = candidates.map(c => `${c.brand} — ${c.productName} (${c.tier})`).join("\n");

      const res = await fetch("/api/claude", {
        method:"POST", headers: CLAUDE_HEADERS,
        body: JSON.stringify({
          model:"claude-sonnet-4-5-20250929", max_tokens:1200,
          system: `You are Jeanie, a denim fit-AI. You will be given a fixed list of real, currently-sold ${fitCategory}'s jean products (brand, product name, price tier) and a detected body shape. Choose exactly 6 entries from that list — one per distinct brand, a good mix of tiers — that best suit the shape. You MUST copy the brand and productName EXACTLY as given; never alter, invent, or substitute a product not on the list. For each chosen entry, write a punchy brand tagline, which recommended style it's "bestFor", and 1–2 sentences ("whyItWorks") grounded in that brand's real fit-system reputation explaining why THIS product suits this shape. Return ONLY a raw JSON array, no markdown, no backticks, no prose. Schema: [{"brand":"...","productName":"...","tagline":"...","bestFor":"...","whyItWorks":"..."}].`,
          messages:[{ role:"user", content:`Body shape: ${fitResult.shape} (${fitCategory}'s fit). Recommended styles: ${fitResult.recommendations.map(r => r.style).join(", ")}.\n\nChoose exactly 6 from this list:\n${candidateList}` }],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      const raw = data.content.filter(b => b.type === "text").map(b => b.text).join("");
      const clean = raw.replace(/```json|```/g, "").trim();
      const m = clean.match(/\[[\s\S]*\]/);
      if (!m) throw new Error("Could not parse brands");
      const aiPicks = JSON.parse(m[0]);

      // Validate every pick against the catalog — tier/priceRange/url always
      // come from OUR data, never the model's, so a hallucinated field can't
      // reach the UI even if the model ignores instructions.
      const usedBrands = new Set();
      let picks = [];
      for (const pick of aiPicks) {
        const match = candidates.find(c => c.brand === pick.brand && c.productName === pick.productName);
        if (!match || usedBrands.has(match.brand)) continue;
        usedBrands.add(match.brand);
        picks.push({
          brand: match.brand, productName: match.productName, tier: match.tier,
          priceRange: match.priceRange, url: match.url,
          tagline: pick.tagline || `${match.brand} denim, done right.`,
          bestFor: pick.bestFor || fitResult.recommendations[0]?.style || "Straight",
          whyItWorks: pick.whyItWorks || `${match.brand}'s ${match.productName} is a proven match for the ${fitResult.shape} shape.`,
        });
      }
      // Backfill from unused candidates if the model returned fewer than 6
      // valid, catalog-verified picks.
      if (picks.length < 6) {
        for (const c of candidates) {
          if (picks.length >= 6) break;
          if (usedBrands.has(c.brand)) continue;
          usedBrands.add(c.brand);
          picks.push({
            brand: c.brand, productName: c.productName, tier: c.tier, priceRange: c.priceRange, url: c.url,
            tagline: `${c.brand} denim, done right.`,
            bestFor: fitResult.recommendations[0]?.style || "Straight",
            whyItWorks: `${c.brand}'s ${c.productName} is a proven match for the ${fitResult.shape} shape.`,
          });
        }
      }
      // Guarantee Abercrombie & Fitch always appears (existing product promise).
      if (!picks.some(p => p.brand === "Abercrombie & Fitch")) {
        const anf = sameGender.find(p => p.brand === "Abercrombie & Fitch" && p.tags.includes(fitResult.shape))
          || sameGender.find(p => p.brand === "Abercrombie & Fitch");
        if (anf) {
          picks = [...picks.slice(0, 5), {
            brand: anf.brand, productName: anf.productName, tier: anf.tier, priceRange: anf.priceRange, url: anf.url,
            tagline: "Denim engineered for real bodies.",
            bestFor: fitResult.recommendations[0]?.style || "Straight",
            whyItWorks: `Abercrombie's ${anf.productName} is cut to suit the ${fitResult.shape} shape.`,
          }];
        }
      }
      setBrands(picks);
    } catch (e) { console.error("Brands error:", e); setBrands([]); }
    finally { setBrandsLoading(false); }
  };

  const processFile = useCallback((file) => {
    if (!file?.type.startsWith("image/")) return;
    setImgMime(file.type || "image/jpeg");
    const reader = new FileReader();
    reader.onload = e => {
      setPreview(e.target.result);
      setImgB64(e.target.result.split(",")[1]);
      setResult(null); setError(null); setBrands(null);
    };
    reader.readAsDataURL(file);
  }, []);

  const analyze = async () => {
    if (!imgB64) return;
    setLoading(true); setError(null); setResult(null); setBrands(null);
    try {
      const res = await fetch("/api/claude", {
        method:"POST", headers: CLAUDE_HEADERS,
        body: JSON.stringify({
          model:"claude-sonnet-4-5-20250929", max_tokens:1000,
          system: fitCategory === "men"
            ? `You are Jeanie, a denim fit-AI trained on the collective wisdom of eight iconic denim brands — Levi's, Wrangler, Lee, Gap, Guess, Mavi, Diesel, and 7 For All Mankind. Your style knowledge draws from Levi's taper expertise, Wrangler's western cut heritage, Lee's relaxed fit innovation, Gap's clean straight-leg tradition, Guess' athletic-tapered fits, Mavi's Jake/Marcus fit systems, Diesel's avant-garde silhouettes, and 7 For All Mankind's tailored straight fits. Look at the photo of a man and return ONLY a raw JSON object — no markdown, no backticks, no prose. Schema: {"shape":"Trapezoid","confidence":92,"shapeDesc":"Short description.","traits":["t1","t2","t3"],"recommendations":[{"style":"Name","reason":"Why"},{"style":"Name","reason":"Why"},{"style":"Name","reason":"Why"}],"avoid":[{"style":"Name","reason":"Why"},{"style":"Name","reason":"Why"}],"tips":"2-3 upbeat styling sentences referencing specific brand fit philosophies where relevant."}. shape must be exactly one of: Trapezoid, Rectangle, Triangle, Inverted Triangle, Oval — using men's body-shape terminology (Trapezoid = broad shoulders tapering to narrower waist; Triangle = narrower shoulders, fuller waist/hips; Inverted Triangle = broad shoulders and chest, narrow waist/hips; Oval = fuller midsection, slimmer legs; Rectangle = uniform width). CONFIDENCE RULES: You are an expert system — be decisive. confidence must be between 85 and 98. Use 92–98 when the body shape is clearly readable from the photo. Use 85–91 only when the image is low quality, heavily obscured, or genuinely ambiguous between two shapes. Never return a confidence below 85.`
            : `You are Jeanie, a denim fit-AI trained on the collective wisdom of eight iconic denim brands — Levi's, Wrangler, Lee, Gap, Guess, Mavi, Diesel, and 7 For All Mankind. Your style knowledge draws from Levi's taper expertise, Wrangler's western cut heritage, Lee's relaxed fit innovation, Gap's clean straight-leg tradition, Guess' curve-flattering premium denim, Mavi's Shaping Technology, Diesel's avant-garde silhouettes, and 7 For All Mankind's Body Contour series. Look at the photo of a woman and return ONLY a raw JSON object — no markdown, no backticks, no prose. Schema: {"shape":"Hourglass","confidence":92,"shapeDesc":"Short description.","traits":["t1","t2","t3"],"recommendations":[{"style":"Name","reason":"Why"},{"style":"Name","reason":"Why"},{"style":"Name","reason":"Why"}],"avoid":[{"style":"Name","reason":"Why"},{"style":"Name","reason":"Why"}],"tips":"2-3 upbeat styling sentences referencing specific brand fit philosophies where relevant."}. shape must be exactly one of: Hourglass, Pear, Apple, Rectangle, Inverted Triangle. CONFIDENCE RULES: You are an expert system — be decisive. confidence must be between 85 and 98. Use 92–98 when the body shape is clearly readable from the photo. Use 85–91 only when the image is low quality, heavily obscured, or genuinely ambiguous between two shapes. Never return a confidence below 85.`,
          messages:[{ role:"user", content:[
            { type:"image", source:{ type:"base64", media_type:imgMime, data:imgB64 } },
            { type:"text", text: `Analyze the body shape (this is a photo of a ${fitCategory === "men" ? "man" : "woman"}) and return ONLY the JSON — no other text.` },
          ]}],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      const raw = data.content.filter(b => b.type === "text").map(b => b.text).join("");
      const clean = raw.replace(/```json|```/g, "").trim();
      const m = clean.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("Could not parse AI response");
      const parsed = JSON.parse(m[0]);
      pendingResult.current = { ok: true, parsed };
      setScanDone(true);
    } catch (e) {
      pendingResult.current = { ok: false, err: e.message };
      setScanDone(true);
    }
  };

  const tierInfo = {
    Luxury:    { color: T.accent,  tip: "Luxury — 7 For All Mankind & Diesel ($150–$350+). Artisan construction, premium Japanese selvedge, signature fit technology." },
    Premium:   { color: T.ink,     tip: "Premium — Mavi & Guess ($80–$150). Elevated fabrics, body-sculpting fits, trend-forward washes." },
    "Mid-Range":{ color:"#4a7aaa", tip: "Mid-Range — Levi's & Gap ($50–$120). Iconic American fits, accessible quality, timeless silhouettes." },
    Budget:    { color: T.mute,    tip: "Budget — Lee & Wrangler ($30–$70). Durable workwear heritage, relaxed fits, outstanding value." },
  };

  const STYLE_TIPS = {
    "High-Rise Wide-Leg": "Elongates the torso, balances hips and shoulders. Works across most body types.",
    "Bootcut": "Slight flare from knee balances wider hips. The classic proportional cut.",
    "Straight Leg": "Clean, versatile silhouette. Works with virtually any top.",
    "Slim Straight": "Tapered without being tight — shows shape without clinging.",
    "Skinny": "Fitted throughout. Works best on slim or proportionate legs.",
    "Flared": "Drama at the hem. Counterbalances wider upper bodies and shoulders.",
    "Mom Jeans": "High-waist, relaxed seat and thigh — retro silhouette with modern utility.",
    "Boyfriend": "Relaxed, slightly slouchy. Casual appeal with a deliberate ease.",
    "Barrel Leg": "Wide through the thigh, tapered at ankle — fashion-forward and directional.",
  };

  return (
    <div style={{ background:T.bg, color:T.ink, fontFamily:"'Inter',system-ui,sans-serif", minHeight:"100vh", overflowX:"hidden", position:"relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&family=Fraunces:ital,opsz,wght@1,9..144,400;1,9..144,600&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        html{scroll-behavior:smooth; background:${T.bg}; -webkit-font-smoothing:antialiased}
        body{background:${T.bg}; color:${T.ink}}
        section[id]{scroll-margin-top:84px}
        a{color:inherit;text-decoration:none}
        button{font-family:inherit}
        img{display:block}
        ::selection{background:${T.accent};color:#fff}

        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
        @keyframes breathe{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-1px) scale(1.012)}}
        @keyframes sway{0%,100%{transform:translateY(-2px) scale(1.06) rotate(-0.6deg)}50%{transform:translateY(-2px) scale(1.06) rotate(0.6deg)}}
        @keyframes pulseHalo{0%,100%{opacity:0.06}50%{opacity:0.16}}
        @keyframes tooltipIn{from{opacity:0;transform:translateX(-50%) translateY(4px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        @keyframes marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}
        @keyframes jeansDrift1{0%{transform:translateY(0px) translateX(0px) rotate(0deg)}20%{transform:translateY(-28px) translateX(12px) rotate(4deg)}45%{transform:translateY(-55px) translateX(-8px) rotate(-3deg)}70%{transform:translateY(-38px) translateX(18px) rotate(6deg)}100%{transform:translateY(0px) translateX(0px) rotate(0deg)}}
        @keyframes jeansDrift2{0%{transform:translateY(0px) translateX(0px) rotate(0deg)}25%{transform:translateY(-40px) translateX(-14px) rotate(-5deg)}50%{transform:translateY(-20px) translateX(22px) rotate(8deg)}75%{transform:translateY(-50px) translateX(-6px) rotate(-4deg)}100%{transform:translateY(0px) translateX(0px) rotate(0deg)}}
        @keyframes jeansDrift3{0%{transform:translateY(0px) translateX(0px) rotate(0deg)}30%{transform:translateY(-18px) translateX(10px) rotate(3deg)}55%{transform:translateY(-44px) translateX(-12px) rotate(-6deg)}80%{transform:translateY(-32px) translateX(8px) rotate(2deg)}100%{transform:translateY(0px) translateX(0px) rotate(0deg)}}
        @keyframes jeansDrift4{0%{transform:translateY(0px) translateX(0px) rotate(0deg)}15%{transform:translateY(-22px) translateX(-16px) rotate(-4deg)}40%{transform:translateY(-50px) translateX(10px) rotate(5deg)}65%{transform:translateY(-30px) translateX(-8px) rotate(-2deg)}85%{transform:translateY(-58px) translateX(14px) rotate(7deg)}100%{transform:translateY(0px) translateX(0px) rotate(0deg)}}
        @keyframes heroImageReveal{from{opacity:0;transform:scale(1.04) translateY(16px)}to{opacity:1;transform:scale(1) translateY(0)}}
        @keyframes fadeSlideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes scanLine{0%{top:-2px;opacity:0.9}100%{top:100%;opacity:0.4}}
        @keyframes scanGrid{0%{opacity:0.04}50%{opacity:0.10}100%{opacity:0.04}}
        @keyframes scanPulse{0%,100%{box-shadow:0 0 0 0 rgba(0,210,140,0.4)}50%{box-shadow:0 0 0 8px rgba(0,210,140,0)}}
        @keyframes scanGlitch{0%,94%,100%{transform:none;opacity:1}95%{transform:translateX(-2px);opacity:0.8}97%{transform:translateX(3px);opacity:0.9}}
        @keyframes scanFlicker{0%,100%{opacity:1}92%{opacity:1}93%{opacity:0.4}94%{opacity:1}}
        @keyframes cornerPulse{0%,100%{opacity:0.5}50%{opacity:1}}
        @keyframes dataStream{0%{transform:translateY(0)}100%{transform:translateY(-50%)}}
        @keyframes dropZonePulse{0%,100%{border-color:rgba(154,120,40,0.3)}50%{border-color:rgba(154,120,40,0.7)}}

        @media(prefers-reduced-motion:reduce){*{animation-duration:0.01ms !important;animation-iteration-count:1 !important;transition-duration:0.01ms !important}}

        .lift{transition:transform 0.4s cubic-bezier(.2,.7,.2,1), border-color 0.3s, box-shadow 0.4s}
        .lift:hover{transform:translateY(-4px); border-color:${T.borderH}; box-shadow:0 12px 40px -8px rgba(0,0,0,0.12)}
        .btn-primary{background:linear-gradient(135deg,${T.red},${T.redH}); color:#fff; transition:all 0.25s; box-shadow:0 4px 20px -4px rgba(184,48,44,0.36)}
        .btn-primary:hover:not(:disabled){background:linear-gradient(135deg,${T.redH},#e04040); box-shadow:0 8px 28px -4px rgba(184,48,44,0.55); transform:translateY(-1px)}
        .btn-primary:active:not(:disabled){transform:scale(0.98)}
        .btn-primary:disabled{background:#d8cfc4; cursor:not-allowed; color:#a09080; box-shadow:none}
        .btn-ghost{background:${T.glass}; color:${T.ink}; border:1px solid ${T.border}; backdrop-filter:blur(12px); transition:all 0.25s}
        .btn-ghost:hover{border-color:${T.borderH}; background:${T.glassH}; transform:translateY(-1px)}
        .link-mute{color:${T.mute}; transition:color 0.2s}
        .link-mute:hover{color:${T.ink}}
        .hero-img{animation:heroImageReveal 1.2s 0.3s cubic-bezier(.2,.7,.2,1) both}
        details>summary{list-style:none}
        details>summary::-webkit-details-marker{display:none}
        .faq-plus{transition:transform 0.3s cubic-bezier(.2,.7,.2,1)}
        details[open] .faq-plus{transform:rotate(45deg)}

        /* Image hover zoom */
        .img-zoom{overflow:hidden; border-radius:24px}
        .img-zoom img{transition:transform 0.7s cubic-bezier(.2,.7,.2,1)}
        .img-zoom:hover img{transform:scale(1.04)}

        /* Stat card hover */
        .stat-card{transition:background 0.3s, transform 0.3s}
        .stat-card:hover{background:rgba(154,120,40,0.06) !important; transform:translateY(-2px)}

        /* Brand card hover */
        .brand-card{transition:transform 0.4s cubic-bezier(.2,.7,.2,1), box-shadow 0.4s}
        .brand-card:hover{transform:translateY(-6px); box-shadow:0 20px 50px -12px rgba(0,0,0,0.14) !important}

        /* Nav link underline */
        .nav-link{position:relative; padding-bottom:2px}
        .nav-link::after{content:''; position:absolute; bottom:0; left:0; width:0; height:1px; background:${T.accent}; transition:width 0.3s}
        .nav-link:hover::after{width:100%}

        /* Process step hover */
        .process-step{transition:transform 0.4s cubic-bezier(.2,.7,.2,1)}
        .process-step:hover{transform:translateY(-8px)}
        .process-num{transition:box-shadow 0.3s, background 0.3s}
        .process-step:hover .process-num{box-shadow:0 0 32px ${T.accentGlow}; background:rgba(154,120,40,0.08)}
      `}</style>

      <MeshBg />
      <FloatingJeans />
      <ScrollProgress />

      {/* ─────────── NAV ─────────── */}
      <nav style={{
        position:"sticky", top:0, zIndex:100, padding: mob ? "14px 16px" : "16px 40px",
        backdropFilter:"blur(32px) saturate(180%)", WebkitBackdropFilter:"blur(32px) saturate(180%)",
        background:"rgba(247,244,239,0.84)", borderBottom:`1px solid ${T.border}`,
        boxShadow:"0 1px 0 rgba(28,18,8,0.05)",
      }}>
        <div style={{ maxWidth:1280, margin:"0 auto", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <a href="#top"><Logo size={mob ? 26 : 32}/></a>
          {mob ? (
            /* Mobile: hamburger + CTA */
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <a href="#analyzer" className="btn-primary" style={{ padding:"8px 16px", borderRadius:999, fontSize:11, fontWeight:500, display:"inline-flex", alignItems:"center", gap:5, cursor:"pointer" }}>
                Try free
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </a>
              <button onClick={() => setNavOpen(o => !o)} aria-label="Toggle menu"
                style={{ width:44, height:44, borderRadius:10, border:`1px solid ${T.border}`, background:T.glass, backdropFilter:"blur(12px)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:5, cursor:"pointer" }}>
                <span style={{ width:18, height:1.5, background:T.ink, borderRadius:1, transition:"all 0.3s", transform: navOpen ? "rotate(45deg) translateY(3.5px)" : "none" }}/>
                <span style={{ width:18, height:1.5, background:T.ink, borderRadius:1, opacity: navOpen ? 0 : 1, transition:"opacity 0.2s" }}/>
                <span style={{ width:18, height:1.5, background:T.ink, borderRadius:1, transition:"all 0.3s", transform: navOpen ? "rotate(-45deg) translateY(-3.5px)" : "none" }}/>
              </button>
            </div>
          ) : (
            /* Desktop: full links */
            <div style={{ display:"flex", gap:32, alignItems:"center" }}>
              {[
                ["Analyze","#analyzer","Upload a photo and get your body shape read + brand matches"],
                ["Shapes","#shapes","Browse all five body archetypes and their styling notes"],
                ["How it works","#process","Three steps from photo to perfect pair"],
                ["FAQ","#faq","Common questions answered honestly"],
              ].map(([l, h, tip]) => (
                <Tooltip key={l} content={tip} maxWidth={200}>
                  <a href={h} className="link-mute nav-link" style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, letterSpacing:"0.04em" }}>{l}</a>
                </Tooltip>
              ))}
              <Magnetic>
                <Tooltip content="Try the AI fit analysis — free, no account needed" maxWidth={200}>
                  <a href="#analyzer" className="btn-primary" style={{ padding:"9px 20px", borderRadius:999, fontSize:12, fontWeight:500, letterSpacing:"0.02em", display:"inline-flex", alignItems:"center", gap:6, cursor:"pointer" }}>
                    Try free
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </a>
                </Tooltip>
              </Magnetic>
            </div>
          )}
        </div>
        {/* Mobile dropdown menu */}
        {mob && navOpen && (
          <div style={{ borderTop:`1px solid ${T.border}`, marginTop:14, paddingTop:14, display:"flex", flexDirection:"column", gap:2 }}>
            {[
              ["Analyze","#analyzer"],
              ["Shapes","#shapes"],
              ["How it works","#process"],
              ["FAQ","#faq"],
            ].map(([l, h]) => (
              <a key={l} href={h} onClick={() => setNavOpen(false)}
                style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, letterSpacing:"0.06em", color:T.inkSoft, padding:"12px 4px", borderBottom:`1px solid ${T.border}`, textDecoration:"none", display:"block" }}>{l}</a>
            ))}
          </div>
        )}
      </nav>

      {/* ─────────── HERO ─────────── */}
      <section id="top" style={{ position:"relative", zIndex:1, padding: mob ? "52px 16px 40px" : "80px 40px 60px", minHeight: mob ? "auto" : "92vh", display:"flex", alignItems:"center" }}>
        <div style={{ maxWidth:1280, margin:"0 auto", width:"100%", display:"grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: mob ? 36 : 64, alignItems:"center" }}>

          {/* Left — Text */}
          <div>
            <FadeIn>
              <Tooltip content="Claude Vision AI is live — analyze your body shape in real time" maxWidth={240}>
                <div style={{
                  display:"inline-flex", alignItems:"center", gap:10, padding:"8px 18px",
                  borderRadius:999, border:`1px solid ${T.borderG}`,
                  background:"rgba(154,120,40,0.06)", backdropFilter:"blur(12px)",
                  marginBottom:36, cursor:"default",
                }}>
                  <span style={{ width:6, height:6, background:"#48c46a", borderRadius:"50%", boxShadow:"0 0 10px #48c46a", animation:"float 2s ease-in-out infinite" }}/>
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.16em", color:T.inkSoft, textTransform:"uppercase" }}>AI Model live · Fit-AI</span>
                </div>
              </Tooltip>
            </FadeIn>

            <FadeIn delay={0.06}>
              <h1 style={{ fontFamily:"'Cormorant Garamond',serif", fontWeight:400, fontSize:"clamp(54px,7vw,108px)", lineHeight:0.92, letterSpacing:"-0.04em", color:T.ink, marginBottom:28 }}>
                Denim that{" "}
                <em style={{ color:T.accent, fontStyle:"italic" }}>actually</em>
                <br/>fits you.
              </h1>
            </FadeIn>

            <FadeIn delay={0.12}>
              <p style={{ maxWidth:480, fontSize:17, lineHeight:1.7, color:T.inkSoft, fontWeight:300, marginBottom:40 }}>
                Upload a photo. Get a precise body-shape read and the exact cuts, rises, and brands engineered for your proportions.
              </p>
            </FadeIn>

            <FadeIn delay={0.18}>
              <div style={{ display:"flex", gap:14, flexWrap:"wrap", marginBottom:56 }}>
                <Magnetic>
                  <Tooltip content="Upload a photo and get your AI body-shape analysis in ~8 seconds" maxWidth={220}>
                    <a href="#analyzer" className="btn-primary" style={{ padding:"17px 36px", borderRadius:999, fontSize:14, fontWeight:500, display:"inline-flex", alignItems:"center", gap:10, cursor:"pointer" }}>
                      Analyze my fit
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </a>
                  </Tooltip>
                </Magnetic>
                <Magnetic>
                  <Tooltip content="See all five body archetypes with styling notes and fit tips" maxWidth={220}>
                    <a href="#shapes" className="btn-ghost" style={{ padding:"17px 36px", borderRadius:999, fontSize:14, fontWeight:500, cursor:"pointer" }}>Body type guide</a>
                  </Tooltip>
                </Magnetic>
              </div>
            </FadeIn>

            {/* Stats strip */}
            <FadeIn delay={0.24}>
              <div style={{ display:"grid", gridTemplateColumns: mob ? "1fr 1fr" : "repeat(4, 1fr)", gap:1, overflow:"hidden", borderRadius:16, border:`1px solid ${T.border}`, boxShadow:"0 4px 20px -4px rgba(0,0,0,0.07)" }}>
                {[
                  ["5",   "Body archetypes", "Hourglass, Pear, Apple, Rectangle, Inverted Triangle"],
                  ["12+", "Jean cut styles",  "From high-rise wide-leg to barrel leg and every cut between"],
                  ["6",   "Brand matches",    "Curated across Luxury, Premium, and Mid-Range tiers"],
                  ["~8s", "Time to result",   "Average time from photo upload to full analysis"],
                ].map(([n,l,tip]) => (
                  <Tooltip key={l} content={tip} maxWidth={210} placement="bottom">
                    <div className="stat-card" style={{ background:T.glass, backdropFilter:"blur(20px)", padding:"22px 16px", cursor:"default", borderRight:`1px solid ${T.border}` }}>
                      <div style={{ fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic", fontSize:34, fontWeight:500, color:T.accent, lineHeight:1 }}>
                        {n.includes("+") || n.includes("~") || n.includes("s") ? n : <CountUp to={parseInt(n)} />}
                      </div>
                      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.16em", color:T.mute, textTransform:"uppercase", marginTop:8 }}>{l}</div>
                    </div>
                  </Tooltip>
                ))}
              </div>
            </FadeIn>
          </div>

          {/* Right — Hero image (hidden on mobile) */}
          {!mob && <FadeIn delay={0.1} y={40}>
            <div className="img-zoom" style={{ position:"relative", borderRadius:24, overflow:"hidden", boxShadow:`0 24px 80px -20px rgba(0,0,0,0.18), 0 0 0 1px ${T.border}`, aspectRatio:"4/3" }}>
              <img
                src="/jeans-hero.jpg"
                alt="A row of premium denim jeans hanging on a rack against a dark chalkboard wall"
                className="hero-img"
                style={{ width:"100%", height:"100%", objectFit:"cover", transform:`translateY(${scrollY * 0.08}px)` }}
              />
              {/* Gradient overlay — left fade for text bleed */}
              <div aria-hidden style={{ position:"absolute", inset:0, background:`linear-gradient(270deg, transparent 40%, ${T.bg}08 100%)` }}/>
              {/* Bottom text overlay */}
              <div aria-hidden style={{ position:"absolute", bottom:0, left:0, right:0, padding:"28px 28px 24px", background:`linear-gradient(0deg, rgba(10,8,6,0.72) 0%, transparent 100%)` }}>
                <div style={{ fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic", fontSize:13, color:"rgba(245,235,220,0.75)", lineHeight:1.6, letterSpacing:"0.04em" }}>
                  "Five body archetypes. Ten trusted brands.<br/>One photo away from the cut that actually fits."
                </div>
              </div>
            </div>
          </FadeIn>}
        </div>
      </section>

      {/* ─────────── MARQUEE ─────────── */}
      <div style={{ position:"relative", zIndex:1, padding:"18px 0", borderTop:`1px solid ${T.border}`, borderBottom:`1px solid ${T.border}`, background:"rgba(240,236,228,0.60)", overflow:"hidden" }}>
        <Marquee text="Body-shape AI analysis · Cut & rise recommendations · Curated across 10 denim brands · Confidence-scored results · Try it free" speed={40}/>
      </div>

      {/* ─────────── SOCIAL PROOF ─────────── */}
      <section style={{ position:"relative", zIndex:1, padding: mob ? "20px 16px 36px" : "28px 40px 52px", borderBottom:`1px solid ${T.border}`, background:"rgba(240,236,228,0.70)", backdropFilter:"blur(20px)" }}>
        <div style={{ maxWidth:1280, margin:"0 auto", display:"flex", alignItems: mob ? "flex-start" : "center", justifyContent:"space-between", gap: mob ? 16 : 32, flexWrap:"wrap", flexDirection: mob ? "column" : "row" }}>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.22em", color:T.mute, textTransform:"uppercase", flexShrink:0 }}>Trained on denim wisdom from</div>
          <div style={{ display:"flex", gap: mob ? 20 : 36, flexWrap:"wrap", alignItems:"center" }}>
            {["LEVI'S","CITIZENS","AGOLDE","FRAME","RE/DONE","MOTHER","KHAITE","SLVRLAKE"].map(b => (
              <Tooltip key={b} content={`${b} — premium denim brand incorporated into training data`} maxWidth={200}>
                <span style={{ fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic", fontSize:19, fontWeight:500, color:T.faint, letterSpacing:"0.02em", transition:"color 0.3s", cursor:"default" }}
                  onMouseEnter={e => e.target.style.color = T.mute}
                  onMouseLeave={e => e.target.style.color = T.faint}
                >{b}</span>
              </Tooltip>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── ANALYZER ─────────── */}
      <section id="analyzer" style={{ position:"relative", zIndex:1, padding: mob ? "60px 16px" : "100px 40px" }}>
        <div style={{ maxWidth:1280, margin:"0 auto" }}>
          <FadeIn>
            <SectionHead eyebrow="01 · The Fit Finder" title={<>Upload, analyze,<br/>get your match.</>} />
          </FadeIn>

          <FadeIn delay={0.05}>
            <div style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 20px", borderRadius:12, marginBottom:28, background:`linear-gradient(90deg, rgba(154,120,40,0.08), transparent)`, border:`1px solid ${T.border}`, borderLeft:`2px solid ${T.accent}`, backdropFilter:"blur(12px)" }}>
              <Tooltip content="These conditions maximize the AI's ability to read body proportions accurately">
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.22em", color:T.accent, textTransform:"uppercase", flexShrink:0, cursor:"default" }}>Pro tip</span>
              </Tooltip>
              <span style={{ fontSize:13, color:T.inkSoft, fontWeight:300 }}>Full-body photo, fitted clothing, straight posture, good light → most accurate read.</span>
            </div>
          </FadeIn>

          <FadeIn delay={0.07}>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24 }}>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.16em", color:T.mute, textTransform:"uppercase" }}>Analyzing for</span>
              <div style={{ display:"inline-flex", padding:4, borderRadius:999, background:T.surfaceB, border:`1px solid ${T.border}`, gap:2 }}>
                {[{ id:"women", label:"Women's Fit" }, { id:"men", label:"Men's Fit" }].map(opt => (
                  <button key={opt.id} onClick={() => setFitCategory(opt.id)}
                    style={{
                      padding:"7px 16px", borderRadius:999, border:"none", cursor:"pointer",
                      fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.05em", fontWeight:500,
                      background: fitCategory === opt.id ? T.accent : "transparent",
                      color: fitCategory === opt.id ? "#fff" : T.inkSoft,
                      transition:"background 0.25s, color 0.25s",
                    }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </FadeIn>

          <div style={{ display:"grid", gridTemplateColumns: mob ? "1fr" : "minmax(0, 5fr) minmax(0, 7fr)", gap:28, alignItems:"start" }}>

            {/* ── Upload ── */}
            <FadeIn delay={0.1}>
              <div>
                <label
                    htmlFor="jeanie-upload"
                    onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                    onDrop={e => { e.preventDefault(); setDragOver(false); processFile(e.dataTransfer.files[0]); }}
                    onDragLeave={() => setDragOver(false)}
                    style={{
                      display:"block", aspectRatio:"3/4", borderRadius:20, cursor:"pointer",
                      position:"relative", overflow:"hidden",
                      border:`1px ${dragOver ? "solid" : "dashed"} ${dragOver ? T.accent : T.border}`,
                      background: dragOver ? `linear-gradient(135deg, rgba(154,120,40,0.08), rgba(31,53,86,0.06))` : T.glass,
                      backdropFilter:"blur(24px)", WebkitBackdropFilter:"blur(24px)",
                      transition:"all 0.3s",
                      boxShadow: dragOver ? `0 0 30px ${T.accentGlow}, inset 0 1px 0 rgba(255,255,255,0.9)` : `0 4px 20px -4px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,0.8)`,
                    }}
                  >
                    {dragOver && <div style={{ position:"absolute", inset:0, background:`radial-gradient(ellipse at 50% 50%, rgba(154,120,40,0.10), transparent 70%)`, pointerEvents:"none" }}/>}
                    {preview ? (
                      <>
                        <img src={preview} alt="Your photo preview" style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover" }} />
                        {/* Sci-fi scan overlay while loading */}
                        {loading && (
                          <div style={{ position:"absolute", inset:0, background:"rgba(4,12,20,0.72)", backdropFilter:"blur(2px)" }}>
                            {/* Grid lines */}
                            <div style={{ position:"absolute", inset:0, backgroundImage:`linear-gradient(rgba(0,210,140,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(0,210,140,0.07) 1px, transparent 1px)`, backgroundSize:"24px 24px", animation:"scanGrid 2s ease-in-out infinite" }}/>
                            {/* Scan line */}
                            <div style={{ position:"absolute", left:0, right:0, height:2, background:`linear-gradient(90deg, transparent, rgba(0,210,140,0.9), rgba(0,255,180,1), rgba(0,210,140,0.9), transparent)`, boxShadow:`0 0 12px rgba(0,255,180,0.8), 0 0 30px rgba(0,210,140,0.4)`, animation:"scanLine 1.4s linear infinite", top:0 }}/>
                            {/* Horizontal guide lines */}
                            {[25,50,75].map(pct => (
                              <div key={pct} style={{ position:"absolute", left:"8%", right:"8%", top:`${pct}%`, height:1, background:"rgba(0,210,140,0.15)", borderTop:"1px dashed rgba(0,210,140,0.2)" }}/>
                            ))}
                            {/* Center crosshair */}
                            <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", width:40, height:40 }}>
                              <div style={{ position:"absolute", top:0, left:0, right:0, bottom:0, border:"1px solid rgba(0,210,140,0.6)", borderRadius:2, animation:"scanPulse 1.5s ease-in-out infinite" }}/>
                              <div style={{ position:"absolute", top:"50%", left:0, right:0, height:1, background:"rgba(0,210,140,0.5)", transform:"translateY(-50%)" }}/>
                              <div style={{ position:"absolute", left:"50%", top:0, bottom:0, width:1, background:"rgba(0,210,140,0.5)", transform:"translateX(-50%)" }}/>
                            </div>
                            {/* Corner brackets */}
                            {[{t:8,l:8},{t:8,r:8},{b:8,l:8},{b:8,r:8}].map((pos,i) => (
                              <div key={i} style={{ position:"absolute", ...Object.fromEntries(Object.entries(pos).map(([k,v])=>[k,v])), width:14, height:14,
                                borderTop: pos.t !== undefined ? "2px solid rgba(0,210,140,0.9)" : "none",
                                borderBottom: pos.b !== undefined ? "2px solid rgba(0,210,140,0.9)" : "none",
                                borderLeft: pos.l !== undefined ? "2px solid rgba(0,210,140,0.9)" : "none",
                                borderRight: pos.r !== undefined ? "2px solid rgba(0,210,140,0.9)" : "none",
                                animation:"cornerPulse 1.8s ease-in-out infinite", animationDelay:`${i*0.15}s`
                              }}/>
                            ))}
                            {/* Data readout */}
                            <div style={{ position:"absolute", bottom:12, left:12, right:12, fontFamily:"'JetBrains Mono',monospace", fontSize:8, letterSpacing:"0.14em", color:"rgba(0,210,140,0.85)", textTransform:"uppercase", lineHeight:1.8, animation:"scanGlitch 4s steps(1) infinite" }}>
                              <div>RES 4K · DEPTH MAP ACTIVE</div>
                              <div style={{ color:"rgba(0,255,180,1)", animation:"scanFlicker 3s infinite" }}>SCANNING {Math.round(scanProg)}%</div>
                            </div>
                          </div>
                        )}
                        {!loading && <div style={{ position:"absolute", inset:0, background:"rgba(247,244,239,0)", transition:"background 0.3s" }}
                          onMouseEnter={e => e.currentTarget.style.background = "rgba(247,244,239,0.25)"}
                          onMouseLeave={e => e.currentTarget.style.background = "rgba(247,244,239,0)"}
                        />}
                      </>
                    ) : (
                      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:0, overflow:"hidden" }}>
                        {/* Animated grid background */}
                        <div style={{ position:"absolute", inset:0, backgroundImage:`linear-gradient(rgba(154,120,40,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(154,120,40,0.06) 1px, transparent 1px)`, backgroundSize:"32px 32px", animation:"scanGrid 3s ease-in-out infinite" }}/>
                        {/* Pulsing drop zone ring */}
                        <div style={{ position:"relative", width:80, height:80, marginBottom:20 }}>
                          <div style={{ position:"absolute", inset:0, borderRadius:"50%", border:`1px solid ${T.borderG}`, animation:"dropZonePulse 2s ease-in-out infinite" }}/>
                          <div style={{ position:"absolute", inset:8, borderRadius:"50%", border:`1px dashed rgba(154,120,40,0.2)`, animation:"dropZonePulse 2s ease-in-out infinite", animationDelay:"0.5s" }}/>
                          <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(154,120,40,0.05)", borderRadius:"50%" }}>
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="1.4" strokeOpacity="0.8">
                              <path d="M12 4v12m0-12l-4 4m4-4l4 4M4 18v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>
                            </svg>
                          </div>
                        </div>
                        <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:24, fontWeight:500, color:T.ink, letterSpacing:"-0.01em", position:"relative" }}>Drop a photo</div>
                        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.14em", color:T.mute, textTransform:"uppercase", marginTop:6, position:"relative" }}>or click to browse</div>
                        {/* Corner brackets */}
                        {[{t:14,l:14},{t:14,r:14},{b:14,l:14},{b:14,r:14}].map((pos,i) => (
                          <div key={i} style={{ position:"absolute", ...Object.fromEntries(Object.entries(pos).map(([k,v])=>[k,v])), width:12, height:12,
                            borderTop: pos.t !== undefined ? `1px solid ${T.accentH}` : "none",
                            borderBottom: pos.b !== undefined ? `1px solid ${T.accentH}` : "none",
                            borderLeft: pos.l !== undefined ? `1px solid ${T.accentH}` : "none",
                            borderRight: pos.r !== undefined ? `1px solid ${T.accentH}` : "none",
                            opacity:0.5, animation:"cornerPulse 2.5s ease-in-out infinite", animationDelay:`${i*0.3}s`
                          }}/>
                        ))}
                        {/* Data label */}
                        <div style={{ position:"absolute", bottom:14, left:14, fontFamily:"'JetBrains Mono',monospace", fontSize:7, letterSpacing:"0.14em", color:T.faint, textTransform:"uppercase" }}>JPEG · PNG · WEBP</div>
                        <div style={{ position:"absolute", bottom:14, right:14, fontFamily:"'JetBrains Mono',monospace", fontSize:7, letterSpacing:"0.14em", color:T.faint, textTransform:"uppercase" }}>ANY DEVICE</div>
                      </div>
                    )}
                    {[{t:"top",l:"left"},{t:"top",l:"right"},{t:"bottom",l:"left"},{t:"bottom",l:"right"}].map(({t,l},i) => (
                      <div key={i} style={{ position:"absolute", [t]:14, [l]:14, width:16, height:16, [`border${t.charAt(0).toUpperCase()+t.slice(1)}`]:`1px solid ${T.accent}`, [`border${l.charAt(0).toUpperCase()+l.slice(1)}`]:`1px solid ${T.accent}`, opacity:0.5 }}/>
                    ))}
                  </label>

                <input id="jeanie-upload" type="file" ref={fileRef} accept="image/*" style={{ display:"none" }} onChange={e => processFile(e.target.files[0])} />
                <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={e => processFile(e.target.files[0])} />

                {/* Mobile: Camera + Gallery row */}
                {mob && (
                  <div style={{ display:"flex", gap:8, marginTop:14 }}>
                    <button
                      onClick={() => cameraRef.current?.click()}
                      style={{ flex:1, padding:"14px 10px", borderRadius:12, border:`1px solid ${T.borderG}`, background:T.glass, backdropFilter:"blur(16px)", display:"flex", alignItems:"center", justifyContent:"center", gap:8, cursor:"pointer", fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.10em", color:T.accent, textTransform:"uppercase" }}
                    >
                      {/* Camera icon */}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                        <circle cx="12" cy="13" r="4"/>
                      </svg>
                      Take photo
                    </button>
                    <button
                      onClick={() => fileRef.current?.click()}
                      style={{ flex:1, padding:"14px 10px", borderRadius:12, border:`1px solid ${T.border}`, background:"rgba(255,253,248,0.6)", display:"flex", alignItems:"center", justifyContent:"center", gap:8, cursor:"pointer", fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.10em", color:T.inkSoft, textTransform:"uppercase" }}
                    >
                      {/* Gallery icon */}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <path d="M21 15l-5-5L5 21"/>
                      </svg>
                      Gallery
                    </button>
                  </div>
                )}

                <button
                  disabled={!imgB64 || loading} onClick={analyze} className="btn-primary"
                  style={{ width:"100%", marginTop:14, padding:"18px", borderRadius:14, border:"none", fontSize:14, fontWeight:500, letterSpacing:"0.01em", display:"flex", alignItems:"center", justifyContent:"center", gap:10, cursor:(!imgB64||loading) ? "not-allowed" : "pointer" }}
                >
                  {loading && <div style={{ width:14, height:14, border:"2px solid rgba(255,255,255,0.3)", borderTopColor:"#fff", borderRadius:"50%", animation:"spin 0.7s linear infinite" }}/>}
                  <span>{loading ? "Analyzing…" : result ? "Analyze a different photo" : "Analyze my body shape"}</span>
                  {!loading && <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </button>

                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.12em", color:T.faint, textTransform:"uppercase", textAlign:"center", marginTop:14, lineHeight:1.8 }}>
                  <Tooltip content="Your image is processed server-side via the Anthropic API and immediately discarded. Zero storage, zero training.">
                    <span style={{ cursor:"default" }}>Image processed in-session · Not stored · Not used for training</span>
                  </Tooltip>
                </div>
              </div>
            </FadeIn>

            {/* ── Results ── */}
            <div id="results" style={{ minHeight:480 }}>
              {!result && !loading && !error && (
                <FadeIn delay={0.15}>
                  <GlassCard style={{ height:480, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", borderStyle:"dashed" }}>
                    <ShapeIcon shapeId="Rectangle" accent={T.mute} size={56}/>
                    <div style={{ fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic", fontSize:28, color:T.mute, marginTop:18, fontWeight:400 }}>Your reading appears here.</div>
                    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.14em", color:T.faint, textTransform:"uppercase", marginTop:10 }}>Awaiting input</div>
                  </GlassCard>
                </FadeIn>
              )}

              {loading && (
                <GlassCard style={{ height:480, display:"flex", flexDirection:"column", justifyContent:"center", padding:"36px 32px", overflow:"hidden", position:"relative", background:"rgba(4,12,20,0.82)", borderColor:"rgba(0,210,140,0.25)", boxShadow:`0 0 40px rgba(0,210,140,0.12), inset 0 1px 0 rgba(0,210,140,0.15)` }}>
                  {/* Animated grid */}
                  <div style={{ position:"absolute", inset:0, backgroundImage:`linear-gradient(rgba(0,210,140,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,210,140,0.04) 1px, transparent 1px)`, backgroundSize:"28px 28px", animation:"scanGrid 2.5s ease-in-out infinite", pointerEvents:"none" }}/>
                  {/* Top data stream */}
                  <div style={{ position:"absolute", top:0, right:24, width:1, height:"100%", overflow:"hidden", opacity:0.3 }}>
                    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:7, color:"rgba(0,210,140,0.8)", lineHeight:1.6, animation:"dataStream 4s linear infinite", whiteSpace:"nowrap" }}>
                      {Array.from({length:40}, (_,i) => <div key={i}>{(Math.random()*9999|0).toString(16).toUpperCase().padStart(4,"0")}</div>)}
                    </div>
                  </div>

                  <div style={{ position:"relative" }}>
                    {/* Header */}
                    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:28 }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:"rgba(0,210,140,1)", boxShadow:"0 0 12px rgba(0,210,140,0.9)", animation:"scanPulse 1.2s ease-in-out infinite" }}/>
                      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.22em", color:"rgba(0,210,140,0.9)", textTransform:"uppercase" }}>JEANIE · VISION SCAN ACTIVE</div>
                      <div style={{ marginLeft:"auto", fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:"rgba(0,210,140,0.5)", animation:"scanFlicker 2.5s infinite" }}>
                        {String(Math.round(scanProg)).padStart(3,"0")}%
                      </div>
                    </div>

                    {/* Current phase */}
                    <div style={{ fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic", fontSize:28, color: scanProg >= 100 ? "rgba(0,255,180,0.95)" : "rgba(220,240,230,0.95)", marginBottom:6, letterSpacing:"-0.01em", animation:"scanGlitch 5s steps(1) infinite", transition:"color 0.3s" }}>
                      {scanProg >= 100 ? "Analysis complete." : `${SCAN_PHASES[scanPhase].toLowerCase().replace(/\b\w/g,c=>c.toUpperCase())}…`}
                    </div>
                    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.18em", color: scanProg >= 100 ? "rgba(0,255,180,0.7)" : "rgba(0,210,140,0.55)", textTransform:"uppercase", marginBottom:32, transition:"color 0.3s" }}>
                      {scanProg >= 100 ? "READING PROPORTIONS — DONE" : `PHASE ${scanPhase + 1} / ${SCAN_PHASES.length}`}
                    </div>

                    {/* Progress bar */}
                    <div style={{ marginBottom:28 }}>
                      <div style={{ height:2, background:"rgba(0,210,140,0.12)", borderRadius:2, overflow:"hidden", marginBottom:6 }}>
                        <div style={{ height:"100%", width:`${scanProg}%`, background:`linear-gradient(90deg, rgba(0,180,120,0.7), rgba(0,255,180,1))`, boxShadow:"0 0 8px rgba(0,255,180,0.8)", borderRadius:2, transition:"width 0.06s linear", position:"relative" }}>
                          <div style={{ position:"absolute", right:0, top:"50%", transform:"translateY(-50%)", width:6, height:6, borderRadius:"50%", background:"rgba(0,255,180,1)", boxShadow:"0 0 10px rgba(0,255,180,1)" }}/>
                        </div>
                      </div>
                      {/* Segment ticks */}
                      <div style={{ display:"flex", justifyContent:"space-between" }}>
                        {SCAN_PHASES.map((_,i) => (
                          <div key={i} style={{ width:1, height:4, background: i <= scanPhase ? "rgba(0,210,140,0.7)" : "rgba(0,210,140,0.15)", transition:"background 0.3s" }}/>
                        ))}
                      </div>
                    </div>

                    {/* Phase checklist */}
                    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                      {SCAN_PHASES.slice(0, Math.min(scanPhase + 2, SCAN_PHASES.length)).map((ph, i) => (
                        <div key={ph} style={{ display:"flex", alignItems:"center", gap:10, opacity: i < scanPhase ? 0.45 : 1 }}>
                          <div style={{ width:12, height:12, borderRadius:2, border:`1px solid ${i < scanPhase ? "rgba(0,210,140,0.6)" : i === scanPhase ? "rgba(0,255,180,1)" : "rgba(0,210,140,0.2)"}`, background: i < scanPhase ? "rgba(0,210,140,0.2)" : "transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, boxShadow: i === scanPhase ? "0 0 8px rgba(0,255,180,0.5)" : "none" }}>
                            {i < scanPhase && <svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1 4l2 2 4-4" stroke="rgba(0,210,140,0.9)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                            {i === scanPhase && <div style={{ width:4, height:4, borderRadius:"50%", background:"rgba(0,255,180,1)", animation:"scanPulse 0.9s ease-in-out infinite" }}/>}
                          </div>
                          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:8, letterSpacing:"0.14em", color: i === scanPhase ? "rgba(0,255,180,0.95)" : "rgba(0,210,140,0.5)", textTransform:"uppercase" }}>{ph}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </GlassCard>
              )}

              {error && !loading && (
                <GlassCard style={{ height:480, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", borderColor:"rgba(184,48,44,0.28)" }}>
                  <div style={{ width:56, height:56, borderRadius:"50%", border:`1px solid ${T.red}`, display:"flex", alignItems:"center", justifyContent:"center", color:T.red, boxShadow:`0 0 24px rgba(184,48,44,0.2)` }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
                  </div>
                  <div style={{ fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic", fontSize:24, color:T.ink, marginTop:18 }}>Analysis failed</div>
                  <div style={{ fontSize:13, color:T.mute, marginTop:10, maxWidth:320, lineHeight:1.6 }}>{error}</div>
                </GlassCard>
              )}

              {result && !loading && (
                <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                  <FadeIn>
                    <GlassCard accent glow style={{ padding:28, display:"flex", gap:24, alignItems:"center" }}>
                      <ShapeIcon shapeId={result.shape} accent={T.accent} size={64}/>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.22em", color:T.accent, textTransform:"uppercase", marginBottom:8 }}>Detected shape</div>
                        <div style={{ fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic", fontWeight:500, fontSize:44, lineHeight:1, letterSpacing:"-0.02em", color:T.ink }}>{result.shape}</div>
                        <div style={{ fontSize:14, color:T.inkSoft, marginTop:10, lineHeight:1.55, fontWeight:300 }}>{result.shapeDesc}</div>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:14 }}>
                          {(result.traits || []).map(t => (
                            <Tooltip key={t} content={`Body trait: ${t}`}>
                              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.10em", color:T.inkSoft, textTransform:"uppercase", padding:"4px 10px", borderRadius:999, border:`1px solid ${T.border}`, background:"rgba(28,18,8,0.03)", cursor:"default" }}>{t}</span>
                            </Tooltip>
                          ))}
                        </div>
                      </div>
                      <ConfidenceRing value={85 + Math.round(((result.confidence || 75) / 100) * 13)}/>
                    </GlassCard>
                  </FadeIn>

                  <FadeIn delay={0.05}>
                    <div style={{ display:"grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap:14 }}>
                      <GlassCard style={{ padding:24 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
                          <div style={{ width:6, height:6, background:T.accent, borderRadius:"50%", boxShadow:`0 0 8px ${T.accent}` }}/>
                          <Tooltip content="These cuts and rises are engineered to flatter your specific proportions">
                            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.22em", color:T.accent, textTransform:"uppercase", cursor:"default" }}>Best cuts</div>
                          </Tooltip>
                        </div>
                        {(result.recommendations || []).map((r, i) => (
                          <Tooltip key={i} content={STYLE_TIPS[r.style] || `${r.style} — a recommended cut for your shape`} maxWidth={220} placement={i === 0 ? "top" : "bottom"}>
                            <div style={{ padding:"10px 0", borderTop:i ? `1px solid ${T.border}` : "none", cursor:"default", transition:"background 0.2s", borderRadius:4 }}
                              onMouseEnter={e => e.currentTarget.style.background = "rgba(154,120,40,0.04)"}
                              onMouseLeave={e => e.currentTarget.style.background = ""}>
                              <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:16, fontWeight:500, color:T.ink, letterSpacing:"-0.01em", marginBottom:3 }}>{r.style}</div>
                              <div style={{ fontSize:12, color:T.mute, lineHeight:1.5, fontWeight:300 }}>{r.reason}</div>
                            </div>
                          </Tooltip>
                        ))}
                      </GlassCard>
                      <GlassCard style={{ padding:24 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
                          <div style={{ width:6, height:6, background:T.red, borderRadius:"50%", boxShadow:`0 0 8px ${T.red}` }}/>
                          <Tooltip content="These cuts work against your proportions — they emphasize the wrong areas">
                            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.22em", color:T.red, textTransform:"uppercase", cursor:"default" }}>Avoid</div>
                          </Tooltip>
                        </div>
                        {(result.avoid || []).map((a, i) => (
                          <Tooltip key={i} content={STYLE_TIPS[a.style] || `${a.style} — why to avoid for your shape`} maxWidth={220} placement="bottom">
                            <div style={{ padding:"10px 0", borderTop:i ? `1px solid ${T.border}` : "none", cursor:"default", transition:"background 0.2s", borderRadius:4 }}
                              onMouseEnter={e => e.currentTarget.style.background = "rgba(184,48,44,0.03)"}
                              onMouseLeave={e => e.currentTarget.style.background = ""}>
                              <div style={{ fontFamily:"'Cormorant Garamond',serif", fontSize:16, fontWeight:500, color:T.ink, letterSpacing:"-0.01em", marginBottom:3 }}>{a.style}</div>
                              <div style={{ fontSize:12, color:T.mute, lineHeight:1.5, fontWeight:300 }}>{a.reason}</div>
                            </div>
                          </Tooltip>
                        ))}
                      </GlassCard>
                    </div>
                  </FadeIn>

                  <FadeIn delay={0.1}>
                    <GlassCard accent style={{ padding:24 }}>
                      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.22em", color:T.accent, textTransform:"uppercase", marginBottom:10 }}>Styling note</div>
                      <div style={{ fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic", fontSize:20, fontWeight:400, color:T.inkSoft, lineHeight:1.55, letterSpacing:"-0.01em" }}>"{result.tips}"</div>
                    </GlassCard>
                  </FadeIn>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── BRANDS ─────────── */}
      {(brandsLoading || (brands && brands.length > 0)) && (
        <section style={{ position:"relative", zIndex:1, padding: mob ? "28px 16px 60px" : "40px 40px 100px" }}>
          <div style={{ maxWidth:1280, margin:"0 auto" }}>
            <FadeIn>
              <SectionHead eyebrow="02 · Curated brands" title={<>The makers built<br/>for <em style={{ color:T.accent }}>your</em> proportions.</>} n="02"/>
            </FadeIn>

            {brandsLoading && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(280px, 1fr))", gap:16 }}>
                {[0,1,2,3,4,5].map(i => (
                  <div key={i} style={{ height:260, borderRadius:18, background:`linear-gradient(90deg, ${T.surfaceB}, ${T.glass}, ${T.surfaceB})`, backgroundSize:"200% 100%", animation:"shimmer 1.8s linear infinite" }}/>
                ))}
              </div>
            )}

            {brands && brands.length > 0 && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(280px, 1fr))", gap:16 }}>
                {brands.map((b, i) => {
                  const ti = tierInfo[b.tier] || tierInfo["Mid-Range"];
                  return (
                    <FadeIn key={i} delay={i * 0.05}>
                      <GlassCard className="brand-card" style={{ padding:0, overflow:"hidden", display:"flex", flexDirection:"column", height:"100%" }}>
                        <div style={{ height:2, background:`linear-gradient(90deg, ${ti.color}, transparent)`, boxShadow:`0 0 10px ${ti.color}30` }}/>
                        <div style={{ padding:26, display:"flex", flexDirection:"column", gap:12, flex:1 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12 }}>
                            <div style={{ fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic", fontWeight:500, fontSize:28, color:T.ink, lineHeight:1.1, letterSpacing:"-0.02em", flex:1 }}>{b.brand}</div>
                            <Tooltip content={ti.tip} maxWidth={230}>
                              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:8, letterSpacing:"0.18em", color:ti.color, textTransform:"uppercase", padding:"4px 9px", borderRadius:999, border:`1px solid ${ti.color}`, whiteSpace:"nowrap", background:`${ti.color}0d`, cursor:"default" }}>{b.tier}</span>
                            </Tooltip>
                          </div>
                          {b.productName && (
                            <Tooltip content="The specific product line recommended for your shape — click Shop to see it">
                              <div style={{ display:"inline-flex", alignItems:"center", gap:6, fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.08em", color:ti.color, textTransform:"uppercase", cursor:"default" }}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.5 7.3l-7-4a1 1 0 00-1 0l-7 4A1 1 0 005 8.1v7.8a1 1 0 00.5.87l7 4a1 1 0 001 0l7-4a1 1 0 00.5-.87V8.1a1 1 0 00-.5-.8z"/><path d="M3.3 7l8.7 5 8.7-5M12 22V12"/></svg>
                                {b.productName}
                              </div>
                            </Tooltip>
                          )}
                          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.06em", color:T.mute, lineHeight:1.5 }}>{b.tagline}</div>
                          <div style={{ height:1, background:T.border, margin:"4px 0" }}/>
                          <div style={{ fontSize:12, color:T.inkSoft, lineHeight:1.55, fontWeight:300 }}>
                            <Tooltip content="The specific jean style from this brand that best suits your body shape">
                              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.16em", color:T.accent, textTransform:"uppercase", display:"block", marginBottom:6, cursor:"default" }}>Best for</span>
                            </Tooltip>
                            {b.bestFor}
                          </div>
                          <div style={{ fontSize:12, color:T.mute, lineHeight:1.55, fontWeight:300, flex:1 }}>{b.whyItWorks}</div>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:8, paddingTop:14, borderTop:`1px solid ${T.border}` }}>
                            <Tooltip content={`Typical price range for ${b.brand} denim`}>
                              <div style={{ fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic", fontSize:20, color:T.accent, cursor:"default" }}>{b.priceRange}</div>
                            </Tooltip>
                            <Magnetic>
                              <a href={b.url} target="_blank" rel="noopener noreferrer"
                                onClick={() => fetch(`/api/r?brand=${encodeURIComponent(b.brand)}&url=${encodeURIComponent(b.url)}`).catch(()=>{})}
                                className="btn-primary" style={{ padding:"8px 16px", borderRadius:999, fontSize:11, fontWeight:500, letterSpacing:"0.04em", display:"inline-flex", alignItems:"center", gap:6, cursor:"pointer" }}>
                                Shop
                                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5h6M5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                              </a>
                            </Magnetic>
                          </div>
                        </div>
                      </GlassCard>
                    </FadeIn>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ─────────── SHAPES GUIDE ─────────── */}
      <section id="shapes" style={{ position:"relative", zIndex:1, padding: mob ? "60px 16px" : "100px 40px", borderTop:`1px solid ${T.border}` }}>
        <div style={{ maxWidth:1280, margin:"0 auto" }}>
          <FadeIn>
            <SectionHead eyebrow="03 · Body archetypes" title={<>The five shapes,<br/>visualized.</>} n="03"/>
          </FadeIn>

          <FadeIn delay={0.05}>
            <div style={{ display:"flex", justifyContent:"center", marginBottom:32 }}>
              <div style={{ display:"inline-flex", padding:4, borderRadius:999, background:T.surfaceB, border:`1px solid ${T.border}`, gap:2 }}>
                {[{ id:"women", label:"Women's Fit" }, { id:"men", label:"Men's Fit" }].map(opt => (
                  <button key={opt.id} onClick={() => setFitCategory(opt.id)}
                    style={{
                      padding:"10px 22px", borderRadius:999, border:"none", cursor:"pointer",
                      fontFamily:"'JetBrains Mono',monospace", fontSize:11, letterSpacing:"0.06em", fontWeight:500,
                      background: fitCategory === opt.id ? T.accent : "transparent",
                      color: fitCategory === opt.id ? "#fff" : T.inkSoft,
                      transition:"background 0.25s, color 0.25s",
                    }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </FadeIn>

          <div style={{ display:"grid", gridTemplateColumns: mob ? "repeat(2, 1fr)" : "repeat(auto-fit, minmax(220px, 1fr))", gap:16 }}>
            {activeShapes.map((sh, i) => (
              <FadeIn key={sh.id} delay={i * 0.06}>
                <ShapeCard shape={sh} active={result?.shape === sh.id} index={i}/>
              </FadeIn>
            ))}
          </div>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9, letterSpacing:"0.14em", color:T.faint, textTransform:"uppercase", textAlign:"center", marginTop:28 }}>
            Hover any card for styling tips
          </div>
        </div>
      </section>

      {/* ─────────── PROCESS ─────────── */}
      <section id="process" style={{ position:"relative", zIndex:1, padding: mob ? "60px 16px" : "100px 40px", borderTop:`1px solid ${T.border}`, borderBottom:`1px solid ${T.border}` }}>
        <div aria-hidden style={{ position:"absolute", inset:0, background:"rgba(232,228,218,0.55)", backdropFilter:"blur(40px)", pointerEvents:"none" }}/>
        <div style={{ maxWidth:1280, margin:"0 auto", position:"relative" }}>
          <FadeIn>
            <SectionHead eyebrow="04 · Process" title={<>From photo<br/>to perfect pair.</>} n="04"/>
          </FadeIn>
          <div style={{ display:"grid", gridTemplateColumns: mob ? "1fr" : "repeat(3, 1fr)", gap:28, position:"relative" }}>
            {!mob && <div aria-hidden style={{ position:"absolute", top:54, left:"16%", right:"16%", height:1, background:`linear-gradient(90deg, transparent, ${T.border}, ${T.border}, transparent)` }}/>}
            {[
              ["Upload","A full-body shot in fitted clothing, even light. Phone camera is plenty.", "JPEG, PNG, WEBP — any format, any device camera. Larger photos give more detail to the model."],
              ["Analyze","Claude's vision model maps shoulder-to-hip ratio, waist definition, and leg proportion against five archetypes.", "The model reads proportions, not clothing color or style. It looks at structural body geometry."],
              ["Match","Cut recommendations, styles to skip, and six brand matches across tiers — luxury to mid-range.", "Brand recommendations factor in your shape, the cut styles that work for you, and tier diversity."],
            ].map(([title, body, tip], i) => (
              <FadeIn key={title} delay={i * 0.1}>
                <Tooltip content={tip} maxWidth={240} placement="bottom">
                  <div className="process-step" style={{ textAlign:"center", cursor:"default" }}>
                    <div className="process-num" style={{
                      width:60, height:60, borderRadius:"50%",
                      background:T.glass, backdropFilter:"blur(20px)",
                      border:`1px solid ${T.borderG}`,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      margin:"0 auto 28px",
                      fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic", fontWeight:500, fontSize:24, color:T.accent,
                      position:"relative", zIndex:1,
                    }}>0{i + 1}</div>
                    <div style={{ fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic", fontWeight:500, fontSize:28, color:T.ink, letterSpacing:"-0.02em", marginBottom:14 }}>{title}</div>
                    <div style={{ fontSize:14, color:T.inkSoft, lineHeight:1.65, fontWeight:300, maxWidth:320, margin:"0 auto" }}>{body}</div>
                  </div>
                </Tooltip>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── FAQ ─────────── */}
      <section id="faq" style={{ position:"relative", zIndex:1, padding: mob ? "60px 16px" : "100px 40px" }}>
        <div style={{ maxWidth:880, margin:"0 auto" }}>
          <FadeIn>
            <SectionHead eyebrow="05 · Questions" title={<>What people<br/>usually ask.</>}/>
          </FadeIn>
          {[
            ["Is my photo stored anywhere?","No. Your image is sent to the AI model for analysis in-session and is not retained on our servers or used for training."],
            ["How accurate is the body-shape read?","Confidence is reported with each analysis. Full-body, fitted-clothing photos in even lighting consistently land above 80% confidence."],
            ["Are the brand links affiliate links?","Yes — clicks help fund the app. They never change which brands we recommend; recommendations are driven by your shape, not by what pays best."],
            ["Why these five body shapes?","They're the framework working stylists actually use. Body diversity is far richer than five buckets, but the archetypes are accurate enough to drive useful fit recommendations."],
            ["Can I try without uploading a photo?","Browse the Body Archetypes section to see which shape sounds closest to your proportions — the cut recommendations from the analyzer apply to anyone who matches that shape."],
          ].map(([q, a], i) => (
            <FadeIn key={q} delay={i * 0.04}>
              <details style={{ borderBottom:`1px solid ${T.border}`, padding:"24px 0" }}>
                <summary style={{ cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center", gap:24 }}>
                  <span style={{ fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic", fontWeight:500, fontSize:22, color:T.ink, letterSpacing:"-0.02em" }}>{q}</span>
                  <Tooltip content="Click to expand answer">
                    <span className="faq-plus" style={{ width:28, height:28, borderRadius:"50%", border:`1px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, color:T.accent, fontSize:16, transition:"border-color 0.2s, box-shadow 0.2s" }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.boxShadow = `0 0 12px ${T.accentGlow}`; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = ""; e.currentTarget.style.boxShadow = ""; }}>+</span>
                  </Tooltip>
                </summary>
                <div style={{ fontSize:14, color:T.inkSoft, lineHeight:1.7, fontWeight:300, marginTop:14, maxWidth:680 }}>{a}</div>
              </details>
            </FadeIn>
          ))}
        </div>
      </section>

      {/* ─────────── CTA ─────────── */}
      <section style={{ position:"relative", zIndex:1, padding: mob ? "60px 16px" : "100px 40px" }}>
        <div style={{ maxWidth:1100, margin:"0 auto" }}>
          <FadeIn>
            <div style={{
              borderRadius:28, padding: mob ? "48px 24px" : "80px 52px", textAlign:"center",
              background:`linear-gradient(135deg, rgba(31,53,86,0.07), rgba(184,48,44,0.05))`,
              border:`1px solid ${T.border}`,
              backdropFilter:"blur(40px) saturate(160%)", WebkitBackdropFilter:"blur(40px) saturate(160%)",
              position:"relative", overflow:"hidden",
              boxShadow:`0 12px 48px -12px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.9)`,
            }}>
              <div aria-hidden style={{ position:"absolute", inset:0, background:`radial-gradient(ellipse 60% 50% at 50% 0%, rgba(154,120,40,0.08), transparent 70%)`, pointerEvents:"none" }}/>
              <div aria-hidden style={{ position:"absolute", top:0, left:"25%", right:"25%", height:1, background:`linear-gradient(90deg, transparent, ${T.accent}, transparent)`, opacity:0.5 }}/>
              <div style={{ position:"relative" }}>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:"0.22em", color:T.accent, textTransform:"uppercase", marginBottom:22, display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
                  <span style={{ display:"inline-block", width:24, height:1, background:T.accent, opacity:0.5 }}/>
                  Ready when you are
                  <span style={{ display:"inline-block", width:24, height:1, background:T.accent, opacity:0.5 }}/>
                </div>
                <h2 style={{ fontFamily:"'Cormorant Garamond',serif", fontWeight:400, fontSize:"clamp(42px,6.5vw,82px)", lineHeight:0.96, letterSpacing:"-0.03em", color:T.ink, marginBottom:26 }}>
                  Stop guessing.<br/><em style={{ color:T.accent }}>Start fitting.</em>
                </h2>
                <p style={{ maxWidth:460, margin:"0 auto 40px", fontSize:16, color:T.inkSoft, fontWeight:300, lineHeight:1.65 }}>
                  One photo. About eight seconds. A reading worth dozens of dressing-room hours.
                </p>
                <Magnetic>
                  <Tooltip content="Free — no account, no card, no catch" placement="top">
                    <a href="#analyzer" className="btn-primary" style={{ display:"inline-flex", alignItems:"center", gap:10, padding:"18px 40px", borderRadius:999, fontSize:14, fontWeight:500, cursor:"pointer" }}>
                      Try Jeanie free
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </a>
                  </Tooltip>
                </Magnetic>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ─────────── FOOTER ─────────── */}
      <footer style={{ position:"relative", zIndex:1, padding: mob ? "40px 16px 32px" : "56px 40px 40px", borderTop:`1px solid ${T.border}` }}>
        <div style={{ maxWidth:1280, margin:"0 auto", display:"flex", justifyContent:"space-between", alignItems:"center", gap:24, flexWrap:"wrap" }}>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <Logo size={28}/>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:T.mute, letterSpacing:"0.06em" }}>© 2026 Jeanie — Denim intelligence</div>
          </div>
          <div style={{ display:"flex", gap:32 }}>
            {[
              ["Privacy","Data handling and privacy policy"],
              ["Terms","Terms of service and usage limits"],
              ["Contact","Reach the team"],
            ].map(([l, tip]) => (
              <Tooltip key={l} content={tip} placement="top">
                <a href="#" className="link-mute" style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, letterSpacing:"0.06em" }}>{l}</a>
              </Tooltip>
            ))}
          </div>
          <div style={{ fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic", fontSize:20, color:T.faint }}>Wear what fits.</div>
        </div>
      </footer>
    </div>
  );
}
