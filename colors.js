// Klil colour fan ("מניפת הגוונים"), taken from
// https://www.klil.co.il/גוונים/  (44 shades, 4 families).
//
// `hex` is the swatch value published on the website. It is a screen
// approximation of a powder coating, not a measured reference — the app lets
// you "teach" each shade from a physical sample to replace it.
// `he` is the official Hebrew name. `en` is an unofficial translation.

export const FAMILIES = {
  neutral: { he: 'הבית הניטרלי', en: 'The Neutral Home' },
  present: { he: 'הבית הנוכח', en: 'The Bold Home' },
  sophisticated: { he: 'הבית המתוחכם', en: 'The Sophisticated Home' },
  woodland: { he: 'הבית בחורש', en: 'The Woodland Home' },
};

export const FINISHES = {
  F: { label: 'FINE IRON', he: 'מרקם עדין', en: 'fine texture' },
  I: { label: 'IRON', he: 'מרקם גס', en: 'coarse texture' },
  M: { label: 'MATT', he: 'מט', en: 'matt' },
};

const raw = [
  // code, hex, finish, family, he, en
  ['K001', '#ffffff', 'M', 'neutral', 'לבן מט', 'Matt White'],
  ['11F', '#f6f6ee', 'F', 'neutral', 'עננים', 'Clouds'],
  ['12F', '#edece8', 'F', 'neutral', 'לבן לאטה', 'Latte White'],
  ['73F', '#e4e5e0', 'F', 'neutral', 'פרח וניל', 'Vanilla Flower'],
  ['17I', '#e7e5ce', 'I', 'neutral', 'שיבולת', 'Wheat Ear'],
  ['21F', '#dad7d2', 'F', 'neutral', 'לבן אבן גיר', 'Limestone White'],
  ['15I', '#e2e2e0', 'I', 'neutral', 'חימר מינרלי', 'Mineral Clay'],
  ['16F', '#e8e6d1', 'F', 'neutral', 'קרם קפה', 'Coffee Cream'],
  ['16I', '#e8e2ca', 'I', 'neutral', 'חלב סויה', 'Soy Milk'],

  ['38F', '#5a5b56', 'F', 'present', 'חלל עמוק', 'Deep Space'],
  ['38I', '#494a4c', 'I', 'present', 'מגע תעשייתי', 'Industrial Touch'],
  ['34F', '#959593', 'F', 'present', 'סלע מנצנץ', 'Sparkling Rock'],
  ['34I', '#959691', 'I', 'present', 'קוורץ מעושן', 'Smoky Quartz'],
  ['95F', '#18191b', 'F', 'present', 'שחור מט', 'Matt Black'],
  ['66I', '#1a1a1a', 'I', 'present', 'אינוקס גס', 'Rough Inox'],
  ['40F', '#3e414a', 'F', 'present', 'מתכת אורבנית', 'Urban Metal'],
  ['40I', '#40484b', 'I', 'present', 'גרפיט גס', 'Rough Graphite'],
  ['49F', '#c1c4bb', 'F', 'present', 'סגסוגת אנודייז', 'Anodized Alloy'],
  ['31F', '#a4a09d', 'F', 'present', 'ערפל מטאוריטי', 'Meteorite Mist'],
  ['47I', '#383836', 'I', 'present', 'אור כוכבים', 'Starlight'],
  ['45F', '#150f0f', 'F', 'present', 'שחור אדמדם', 'Reddish Black'],
  ['43F', '#1f2d2d', 'F', 'present', 'לילה ביער', 'Forest Night'],

  ['51I', '#cbcfce', 'I', 'sophisticated', 'קוביית קרח', 'Ice Cube'],
  ['42I', '#4b4f58', 'I', 'sophisticated', 'כחול מלכותי', 'Royal Blue'],
  ['52F', '#bdc6c5', 'F', 'sophisticated', 'כחול בהיר', 'Light Blue'],
  ['53I', '#aeafa9', 'I', 'sophisticated', 'דמדומי חלום', 'Dream Twilight'],
  ['57I', '#6a6b6d', 'I', 'sophisticated', 'לילה מעורפל', 'Misty Night'],
  ['59I', '#0a1825', 'I', 'sophisticated', 'כחול חצות', 'Midnight Blue'],
  ['65F', '#2a343d', 'F', 'sophisticated', 'שיר ערש חצות', 'Midnight Lullaby'],
  ['55I', '#36465f', 'I', 'sophisticated', 'כחול נורדי', 'Nordic Blue'],

  ['33I', '#8d8d85', 'I', 'woodland', 'אפור ירק', 'Green Grey'],
  ['19I', '#e0e0d4', 'I', 'woodland', 'ירוק נעים', 'Soft Green'],
  ['63I', '#a09f8b', 'I', 'woodland', 'קציר זיתים', 'Olive Harvest'],
  ['67I', '#6d715a', 'I', 'woodland', 'טחב עירוני', 'Urban Moss'],
  ['61F', '#abb39b', 'F', 'woodland', 'ליים מנצנץ', 'Sparkling Lime'],
  ['68F', '#173831', 'F', 'woodland', 'יער אמרלד', 'Emerald Forest'],
  ['79F', '#e2d7c3', 'F', 'woodland', 'דמדומי סתיו', 'Autumn Twilight'],
  ['75I', '#38332f', 'I', 'woodland', 'חום אגוז', 'Walnut Brown'],
  ['74I', '#54382c', 'I', 'woodland', 'פלדה חלודה', 'Rusted Steel'],
  ['77I', '#ddd7bf', 'I', 'woodland', 'דיונת מדבר', 'Desert Dune'],
  ['76I', '#b0aca0', 'I', 'woodland', 'סוכר קינמון', 'Cinnamon Sugar'],
  ['35I', '#b2aa95', 'I', 'woodland', "גרייג'", 'Greige'],
  ['36I', '#454136', 'I', 'woodland', 'חום בזלת', 'Basalt Brown'],
  ['39I', '#c3bfb3', 'I', 'woodland', 'לוסטר מוקה', 'Mocha Luster'],
];

export const COLORS = raw.map(([code, hex, finish, family, he, en]) => ({
  code, hex, finish, family, he, en,
}));
