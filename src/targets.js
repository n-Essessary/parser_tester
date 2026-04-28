export const targets = {
  eldorado: {
    name: "Eldorado WoW Classic Gold",
    url: "https://www.eldorado.gg/wow-classic-gold/g/92-0-0?te_v0=NA%20%26%20OC%20Anniversary&te_v1=Nightslayer&te_v2=Alliance"
  },
  z2u: {
    name: "Z2U WoW Classic TBC Gold",
    url: "https://www.z2u.com/wow-classic-tbc/Gold-1-13024"
  }
};

export function getTarget(key) {
  return targets[key] ?? null;
}
