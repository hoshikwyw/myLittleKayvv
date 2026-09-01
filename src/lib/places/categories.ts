/**
 * Turning what a person asked for into what OpenStreetMap calls it.
 *
 * This exists because the two services behind this feature answer different
 * questions. Nominatim geocodes — give it "Shwedagon Pagoda" and it finds the
 * pagoda. Ask it for "coffee shop in Yangon" and it returns *nothing*, which
 * is exactly the request this feature is for.
 *
 * Overpass answers the other question — every café within a radius — but only
 * if you already know the tag is `amenity=cafe`. So a query is matched against
 * this table first, and only falls through to Nominatim when nothing here fits.
 *
 * Written out by hand rather than derived. OSM's tagging is not regular: a
 * pharmacy is `amenity`, a bakery is `shop`, a park is `leisure`, and a hotel
 * is `tourism`. There is no rule to infer, only a list to maintain.
 */

export interface Category {
  /** What OSM calls it, as key/value pairs that are each worth querying. */
  tags: Array<[string, string]>;
  /** Shown to the user in place of the raw tag. */
  label: string;
  /** Lower-case words that should select this category. */
  keywords: string[];
}

export const CATEGORIES: Category[] = [
  {
    label: "Cafe",
    tags: [["amenity", "cafe"]],
    // "Tea shop" matters here specifically: in Yangon it is the default place
    // to sit down, and OSM tags them as cafés.
    keywords: ["coffee", "cafe", "café", "tea shop", "teashop", "tea house", "espresso"],
  },
  {
    label: "Restaurant",
    tags: [["amenity", "restaurant"], ["amenity", "fast_food"]],
    keywords: ["restaurant", "food", "eat", "dinner", "lunch", "noodle", "curry", "bbq"],
  },
  {
    label: "Bar",
    tags: [["amenity", "bar"], ["amenity", "pub"]],
    keywords: ["bar", "pub", "beer", "drinks", "cocktail"],
  },
  {
    label: "Bakery",
    tags: [["shop", "bakery"]],
    keywords: ["bakery", "bread", "cake", "pastry"],
  },
  {
    label: "Pharmacy",
    tags: [["amenity", "pharmacy"], ["shop", "chemist"]],
    keywords: ["pharmacy", "chemist", "medicine", "drugstore", "drug store"],
  },
  {
    label: "Hospital",
    tags: [["amenity", "hospital"], ["amenity", "clinic"], ["amenity", "doctors"]],
    keywords: ["hospital", "clinic", "doctor", "emergency", "medical"],
  },
  {
    label: "Dentist",
    tags: [["amenity", "dentist"]],
    keywords: ["dentist", "dental"],
  },
  {
    label: "ATM",
    tags: [["amenity", "atm"]],
    keywords: ["atm", "cash machine", "cashpoint", "withdraw"],
  },
  {
    label: "Bank",
    tags: [["amenity", "bank"]],
    keywords: ["bank"],
  },
  {
    label: "Petrol station",
    tags: [["amenity", "fuel"]],
    keywords: ["petrol", "gas station", "fuel", "diesel"],
  },
  {
    label: "Supermarket",
    tags: [["shop", "supermarket"], ["shop", "convenience"]],
    keywords: ["supermarket", "grocery", "groceries", "convenience store", "minimart"],
  },
  {
    label: "Market",
    tags: [["amenity", "marketplace"]],
    keywords: ["market", "bazaar", "zay"],
  },
  {
    label: "Hotel",
    tags: [["tourism", "hotel"], ["tourism", "guest_house"]],
    keywords: ["hotel", "guesthouse", "guest house", "stay", "accommodation"],
  },
  {
    label: "Park",
    tags: [["leisure", "park"], ["leisure", "garden"]],
    keywords: ["park", "garden", "green space"],
  },
  {
    label: "Place of worship",
    tags: [["amenity", "place_of_worship"]],
    keywords: ["temple", "pagoda", "church", "mosque", "monastery", "shrine"],
  },
  {
    label: "Gym",
    tags: [["leisure", "fitness_centre"]],
    keywords: ["gym", "fitness", "workout"],
  },
  {
    label: "Bookshop",
    tags: [["shop", "books"]],
    keywords: ["bookshop", "bookstore", "books"],
  },
  {
    label: "Laundry",
    tags: [["shop", "laundry"], ["shop", "dry_cleaning"]],
    keywords: ["laundry", "laundrette", "dry cleaning"],
  },
  {
    label: "Post office",
    tags: [["amenity", "post_office"]],
    keywords: ["post office", "postal", "parcel"],
  },
  {
    label: "Police",
    tags: [["amenity", "police"]],
    keywords: ["police", "police station"],
  },
  {
    label: "Bus stop",
    tags: [["highway", "bus_stop"], ["amenity", "bus_station"]],
    keywords: ["bus stop", "bus station", "bus"],
  },
];

/**
 * The category a phrase is asking for, or null.
 *
 * Longest keyword first, so "tea shop" is not beaten by "shop" appearing
 * inside some other entry — the more specific phrase is the better guess about
 * what somebody meant.
 */
export function categoryFor(query: string): Category | null {
  const text = query.toLowerCase();

  let best: { category: Category; length: number } | null = null;

  for (const category of CATEGORIES) {
    for (const keyword of category.keywords) {
      if (!text.includes(keyword)) continue;
      if (!best || keyword.length > best.length) {
        best = { category, length: keyword.length };
      }
    }
  }

  return best?.category ?? null;
}
