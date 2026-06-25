"""v1.0.8 theme presets.

Each preset is the full color palette the frontend ThemeProvider needs.
Households pick a preset by `id` (or send a `custom` object); the backend
just stores whatever the client sent — it doesn't validate hex colors so
new presets can be added on the client without a backend deploy.
"""
from typing import List, Dict, Any

THEME_PRESETS: List[Dict[str, Any]] = [
    {
        "id": "classic_red",
        "name": "Classic Red",
        "description": "The original CheerPlanner look",
        "accent": "#E11D48",
        "accentSubtle": "#FEE2E2",
        "bg": "#F8FAFC",
        "card": "#FFFFFF",
        "textPrimary": "#0F172A",
        "tabActive": "#E11D48",
    },
    {
        "id": "patriotic",
        "name": "Patriotic",
        "description": "Red, white & blue \u2014 perfect for Worlds week",
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
        "description": "Premier-team energy",
        "accent": "#EAB308",
        "accentSubtle": "#FEF3C7",
        "bg": "#0F172A",
        "card": "#1E293B",
        "textPrimary": "#F8FAFC",
        "tabActive": "#FACC15",
    },
    {
        "id": "pink_power",
        "name": "Pink Power",
        "description": "Bright & playful",
        "accent": "#DB2777",
        "accentSubtle": "#FCE7F3",
        "bg": "#FDF2F8",
        "card": "#FFFFFF",
        "textPrimary": "#831843",
        "tabActive": "#DB2777",
    },
    {
        "id": "purple_reign",
        "name": "Purple Reign",
        "description": "Bold violet & lavender",
        "accent": "#7C3AED",
        "accentSubtle": "#EDE9FE",
        "bg": "#FAF5FF",
        "card": "#FFFFFF",
        "textPrimary": "#3B0764",
        "tabActive": "#7C3AED",
    },
    {
        "id": "forest_green",
        "name": "Forest Green",
        "description": "Earthy & calm",
        "accent": "#15803D",
        "accentSubtle": "#DCFCE7",
        "bg": "#F0FDF4",
        "card": "#FFFFFF",
        "textPrimary": "#14532D",
        "tabActive": "#15803D",
    },
    {
        "id": "ocean_teal",
        "name": "Ocean Teal",
        "description": "Cool & focused",
        "accent": "#0D9488",
        "accentSubtle": "#CCFBF1",
        "bg": "#F0FDFA",
        "card": "#FFFFFF",
        "textPrimary": "#134E4A",
        "tabActive": "#0D9488",
    },
    {
        "id": "dark_mode",
        "name": "Dark Mode",
        "description": "Easy on the eyes at midnight",
        "accent": "#F472B6",
        "accentSubtle": "#831843",
        "bg": "#0B1220",
        "card": "#111827",
        "textPrimary": "#F8FAFC",
        "tabActive": "#F472B6",
    },
]


DEFAULT_THEME = {
    "preset_id": "classic_red",
    "custom": None,
}
