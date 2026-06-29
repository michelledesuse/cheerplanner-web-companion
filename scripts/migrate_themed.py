import re, sys, pathlib

FILES = [
    "app/(tabs)/reminders.tsx",
    "app/athletes/new.tsx",
    "app/bookings/new.tsx",
    "app/competitions/[id].tsx",
    "app/competitions/new.tsx",
    "app/forgot-password.tsx",
    "app/fundraisers.tsx",
    "app/index.tsx",
    "app/login.tsx",
    "app/reset.tsx",
    "app/schedule/new.tsx",
    "app/settings/notifications.tsx",
    "app/signup.tsx",
    "app/teams.tsx",
    "src/components/ApplyFundraiserSheet.tsx",
    "src/components/ApplyPaymentSheet.tsx",
    "src/components/ColorField.tsx",
    "src/components/CompetitionTeamsSection.tsx",
    "src/components/DateField.tsx",
    "src/components/DateTimeField.tsx",
    "src/components/MapLink.tsx",
    "src/components/PackingListSection.tsx",
    "src/components/TimeField.tsx",
]

ROOT = pathlib.Path("/app/frontend")

def migrate(text):
    if "useThemedStyles" in text:
        return text, "already"
    if "const styles = StyleSheet.create({" not in text:
        return text, "no-stylesheet"

    # 1) styles factory
    text = text.replace("const styles = StyleSheet.create({", "const makeStyles = () => ({")

    # 2) hook import (after @/src/theme import, else after react-native import)
    hook_imp = 'import { useThemedStyles } from "@/src/hooks/useThemedStyles";'
    if re.search(r'import \{[^}]*\} from "@/src/theme";', text):
        text = re.sub(r'(import \{[^}]*\} from "@/src/theme";)', r'\1\n' + hook_imp, text, count=1)
    else:
        text = re.sub(r'(import \{[^}]*\} from "react-native";)', r'\1\n' + hook_imp, text, count=1)

    # 3) remove StyleSheet from react-native import IF no longer used elsewhere
    if not re.search(r'StyleSheet\.', text):
        m = re.search(r'import\s*\{([^}]*)\}\s*from\s*"react-native";', text)
        if m:
            names = [n.strip() for n in m.group(1).split(",")]
            names = [n for n in names if n and n != "StyleSheet"]
            new_imp = "import { " + ", ".join(names) + ' } from "react-native";'
            text = text[:m.start()] + new_imp + text[m.end():]

    # 4) inject hook as first statement of each component (Capitalized fn, single-line sig)
    text = re.sub(
        r'(?m)^((?:export default )?function [A-Z]\w*\([^\n]*\)\s*\{)[ \t]*$',
        r'\1\n  const styles = useThemedStyles(makeStyles);',
        text,
    )
    return text, "migrated"

results = {}
for rel in FILES:
    p = ROOT / rel
    if not p.exists():
        results[rel] = "MISSING"
        continue
    src = p.read_text()
    out, status = migrate(src)
    if status == "migrated":
        p.write_text(out)
    results[rel] = status

for k, v in results.items():
    print(f"{v:12} {k}")
