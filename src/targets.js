export const targets = {
  z2u: {
    name: "Z2U",
    url: "https://www.z2u.com/",
    listingUrl: "https://www.z2u.com/wow-classic-tbc/Gold-1-13024"
  },
  igv: {
    name: "IGV",
    url: "https://www.igv.com/",
    listingUrl: "https://www.igv.com/wow-classic-gold"
  },
  g2a: {
    name: "G2A",
    url: "https://www.g2a.com/",
    listingUrl: "https://www.g2a.com/category/gaming-c1"
  },
  zeusx: {
    name: "ZeusX",
    url: "https://www.zeusx.com/",
    listingUrl: "https://www.zeusx.com/game/world-of-warcraft-classic-gold"
  }
};

export function getTarget(key) {
  return targets[key] ?? null;
}
