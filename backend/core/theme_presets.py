"""v1.0.8 theme presets.

Naming convention: each preset's `name` is just the color list it contains
(e.g. "Red & White") — no fancy monikers, so users always know what they're
picking. Add new presets here without a backend deploy on the client.
"""
from typing import List, Dict, Any

THEME_PRESETS: List[Dict[str, Any]] = [
    {
        "id": "red_white",
        "name": "Red & White",
        "accent": "#E11D48",
        "accentSubtle": "#FEE2E2",
        "bg": "#F8FAFC",
        "card": "#FFFFFF",
        "textPrimary": "#0F172A",
        "tabActive": "#E11D48",
    },
    {
        "id": "red_white_blue",
        "name": "Red, White & Blue",
        "accent": "#1D4ED8",
        "accentSubtle": "#DBEAFE",
        "bg": "#FFFFFF",
        "card": "#F8FAFC",
        "textPrimary": "#0F172A",
        "tabActive": "#DC2626",
    },
    {
        "id": "gold_black",
        "name": "Gold & Black",
        "accent": "#EAB308",
        "accentSubtle": "#FEF3C7",
        "bg": "#0F172A",
        "card": "#1E293B",
        "textPrimary": "#F8FAFC",
        "tabActive": "#FACC15",
    },
    {
        "id": "royal_blue_black",
        "name": "Royal Blue & Black",
        "accent": "#2563EB",
        "accentSubtle": "#1E3A8A",
        "bg": "#0B1220",
        "card": "#111827",
        "textPrimary": "#F8FAFC",
        "tabActive": "#3B82F6",
    },
    {
        "id": "royal_blue_white",
        "name": "Royal Blue & White",
        "accent": "#2563EB",
        "accentSubtle": "#DBEAFE",
        "bg": "#F8FAFC",
        "card": "#FFFFFF",
        "textPrimary": "#0F172A",
        "tabActive": "#2563EB",
    },
    {
        "id": "pink_white",
        "name": "Pink & White",
        "accent": "#DB2777",
        "accentSubtle": "#FCE7F3",
        "bg": "#FDF2F8",
        "card": "#FFFFFF",
        "textPrimary": "#831843",
        "tabActive": "#DB2777",
    },
    {
        "id": "purple_white",
        "name": "Purple & White",
        "accent": "#7C3AED",
        "accentSubtle": "#EDE9FE",
        "bg": "#FAF5FF",
        "card": "#FFFFFF",
        "textPrimary": "#3B0764",
        "tabActive": "#7C3AED",
    },
    {
        "id": "green_white",
        "name": "Green & White",
        "accent": "#15803D",
        "accentSubtle": "#DCFCE7",
        "bg": "#F0FDF4",
        "card": "#FFFFFF",
        "textPrimary": "#14532D",
        "tabActive": "#15803D",
    },
    {
        "id": "teal_white",
        "name": "Teal & White",
        "accent": "#0D9488",
        "accentSubtle": "#CCFBF1",
        "bg": "#F0FDFA",
        "card": "#FFFFFF",
        "textPrimary": "#134E4A",
        "tabActive": "#0D9488",
    },
    {
        "id": "dark",
        "name": "Black & Pink",
        "accent": "#F472B6",
        "accentSubtle": "#831843",
        "bg": "#0B1220",
        "card": "#111827",
        "textPrimary": "#F8FAFC",
        "tabActive": "#F472B6",
    },
]


DEFAULT_THEME = {
    "preset_id": "red_white",
    "custom": None,
}
