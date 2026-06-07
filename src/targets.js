export const config = {
  probe: {
    intervalMin: Number(process.env.PROBE_INTERVAL_MIN ?? 10),
    windowMin: Number(process.env.PROBE_WINDOW_MIN ?? 120),
    offerRowsThreshold: Number(process.env.OFFER_ROWS_THRESHOLD ?? 1),
    minRealListingRate: Number(process.env.MIN_REAL_LISTING_RATE ?? 0.5),
    maxJitterMs: Number(process.env.PROBE_MAX_JITTER_MS ?? 3500)
  },
  targets: {
    z2u: {
      name: "Z2U",
      url: "https://www.z2u.com/",
      listingUrls: [
        "https://www.z2u.com/wow-classic-tbc/Gold-1-13024"
        // TODO: Classic Era category URL
        // TODO: MoP Classic category URL
        // TODO: Retail category URL
        // TODO: OSRS category URL
      ]
    },
    igv: {
      name: "IGV",
      url: "https://www.igv.com/",
      listingUrls: [
        "https://www.igv.com/wow-classic-gold"
      ]
    },
    g2a: {
      name: "G2A",
      url: "https://www.g2a.com/",
      listingUrls: [
        "https://www.g2a.com/category/gaming-c1"
      ]
    },
    zeusx: {
      name: "ZeusX",
      url: "https://www.zeusx.com/",
      listingUrls: [
        "https://www.zeusx.com/game/world-of-warcraft-classic-gold"
      ]
    }
  }
};

export const targets = config.targets;

export function getTarget(key) {
  return targets[key] ?? null;
}
