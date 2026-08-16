import React from "react";
import StaticPage, { LegalSection, P } from "@/src/components/StaticPage";

export default function GuidelinesScreen() {
  return (
    <StaticPage title="Community Guidelines" subtitle="For Team Chat & Community Reviews">
      <LegalSection>
        <P>CheerPlanner is a place for cheer families, coaches, and staff to organize and communicate. To keep it safe for everyone — including minor athletes — you agree to these guidelines whenever you post in Team Chat or Community Reviews. We do not tolerate objectionable content or abusive users.</P>
      </LegalSection>

      <LegalSection heading="Be respectful">
        <P>No harassment, bullying, hate speech, threats, or personal attacks. Treat teammates, families, and other users the way you'd want your own athlete treated.</P>
      </LegalSection>

      <LegalSection heading="Keep it appropriate">
        <P>No sexual, violent, graphic, or otherwise objectionable content. No content that exploits or endangers minors in any way. Remember minors may be present in Team Chat.</P>
      </LegalSection>

      <LegalSection heading="No spam or misuse">
        <P>Don't post spam, scams, advertising, or repetitive content. Don't share other people's private information without permission.</P>
      </LegalSection>

      <LegalSection heading="How we enforce this">
        <P>Messages and reviews are automatically screened for objectionable language. Any member can report content or block another user. Content that is reported by multiple people is automatically hidden pending review. You can delete your own content, and our team can remove content and eject users who violate these guidelines — typically within 24 hours of a report.</P>
      </LegalSection>

      <LegalSection heading="Protecting minors in Team Chat">
        <P>A minor athlete can only join Team Chat with their own login after a parent/guardian approves it. Minors chat only in a supervised group thread (no private one-to-one messages), and a parent/guardian can see the conversation and revoke access at any time.</P>
      </LegalSection>

      <LegalSection heading="Reporting a problem">
        <P>Long-press a message (or use the report option on a review) to flag it, or email us at info@cheer-planner.com. We review every report.</P>
      </LegalSection>
    </StaticPage>
  );
}
