import React from "react";
import StaticPage, { LegalSection, P } from "@/src/components/StaticPage";

export default function PrivacyScreen() {
  return (
    <StaticPage title="Privacy Policy" subtitle="Last updated: June 20, 2026">
      <LegalSection>
        <P>CheerPlanner ("we," "our," or "us") is a mobile application that helps cheerleading families organize expenses, competition travel, schedules, and packing lists. This Privacy Policy explains how CheerPlanner collects, uses, and protects your information when you use the CheerPlanner mobile application and related services (the "Service"), and the choices you have. By creating an account and using CheerPlanner, you agree to the practices described in this policy.</P>
      </LegalSection>

      <LegalSection heading="1. Information We Collect">
        <P>We collect information you provide directly, including your name, email address, mobile phone number (if you opt in to SMS), and the household, athlete, competition, expense, payment, travel, and schedule details you enter into the app.</P>
        <P>We also collect basic technical data such as device type and app usage needed to operate the Service.</P>
        <P>If you use Team Hub (see below), you may also provide information about other people — such as team members, athletes, and their parents/guardians — including names, contact details, uniform/apparel sizes, paperwork completion status, and payment tracking notes. You may enter this manually or upload it by importing a spreadsheet (CSV or Excel) file.</P>
        <P>You may also add photos (for example, an athlete or staff profile photo, or photos attached to a competition, event, fundraiser, sign-up, payment, or paperwork record) and, in Team Hub, audio files (“Team Music”). If you share a roster link, a parent/guardian can upload a single photo of their athlete or staff member without logging in. Any photos or audio you add are stored as part of your account so they can sync across your household and Team Hub.</P>
      </LegalSection>

      <LegalSection heading="2. Team Hub (for Coaches & Team Staff)">
        <P>Team Hub is an optional workspace for coaches, team reps, and staff to organize a team roster, sizes, paperwork, payment tracking, volunteer sign-ups, and shared team music. Access is controlled by the account owner, who grants Team Hub access to specific people and can invite others by email.</P>
        <P>The account owner may also share a single reusable team join code. When someone joins with it, they are placed in a pending "New Members" list with group-chat-only access until the owner assigns them a role (Parent of an Athlete, Coach, Staff, or Athlete) and attaches them to the appropriate profile. The owner can change a member's role or remove them at any time.</P>
        <P>If you enter or upload information about other individuals — including photos or audio — you are responsible for having the appropriate authority or consent to do so, and for using that information solely for legitimate team-management purposes. This data is visible only to household logins you have granted Team Hub access. If a person listed in your roster asks you to remove their information, you can delete it within the app.</P>
      </LegalSection>

      <LegalSection heading="3. Uploaded Files & Media">
        <P>When you import a spreadsheet, we process the file only to extract the rows you choose to import and to create the corresponding records in your account. Photos and audio files you upload are stored solely to provide the feature you used them for (for example, showing an athlete’s profile photo or letting your team play shared music) and to sync them across your household and Team Hub. We do not use uploaded files or media for any other purpose, and we do not sell them.</P>
      </LegalSection>

      <LegalSection heading="4. How We Use Your Information">
        <P>We use your information to provide and improve the Service, sync your data across your devices and household members you invite, and to send you the reminders and notifications you have enabled (email and, if you opt in, SMS).</P>
      </LegalSection>

      <LegalSection heading="5. SMS / Text Message Reminders">
        <P>If you opt in, we use your mobile number solely to send you account-related reminder text messages (such as payment due dates, upcoming competitions, and travel deadlines).</P>
        <P>Message frequency varies based on your activity and preferences. Message and data rates may apply. You can opt out at any time by replying STOP to any message or by turning off SMS reminders in Settings → Notifications. Reply HELP for help.</P>
        <P>Consent to receive text messages is not a condition of using the Service. Mobile information (including your phone number) is used only to deliver the reminders you request.</P>
        <P>We do not sell, rent, or share your mobile opt-in data or phone number with third parties or affiliates for their own marketing purposes. Message delivery is handled by our SMS provider (Twilio) strictly to transmit your reminders.</P>
      </LegalSection>

      <LegalSection heading="6. How We Share Information">
        <P>We do not sell your personal information. We share data only with service providers that help us operate the Service (such as cloud hosting, email delivery, and SMS delivery), with household members you explicitly invite or people you grant Team Hub access, or when required by law.</P>
        <P>If you purchase a Premium subscription, the transaction is processed by the Apple App Store; we and our subscription-management provider receive only your subscription status (active, trial, expired) to unlock Premium features — never your full payment card details.</P>
      </LegalSection>

      <LegalSection heading="7. Data Retention & Security">
        <P>We retain your information for as long as your account is active. You can delete your account and associated data at any time from Settings → Delete Account. We use industry standard measures to protect your data, though no method of transmission or storage is completely secure.</P>
      </LegalSection>

      <LegalSection heading="8. Your Choices">
        <P>You may update your notification preferences, opt out of SMS, or delete your account at any time within the app. To request access to or deletion of your data, contact us using the details below.</P>
      </LegalSection>

      <LegalSection heading="9. Children's Privacy">
        <P>CheerPlanner is intended for use by parents, guardians, coaches, and team staff. It is not directed to children under 13, and we do not knowingly collect personal information directly from children under 13.</P>
        <P>Team Chat may include minor athletes only when a minor uses their own login and a parent/guardian (the account owner or a caretaker listed on that athlete's roster entry) explicitly approves chat access. This parent-controlled safeguard is called ParentGuard in the app. A minor's chat access is OFF by default until approved, all chat takes place in a supervised group thread (there are no private one-to-one messages for minors), and every message a minor sends or receives is visible to their parent/guardian. A guardian can revoke a minor's chat access at any time, which also removes their ability to post. If you believe a child has provided us information without appropriate consent, contact us and we will delete it.</P>
      </LegalSection>

      <LegalSection heading="10. Team Chat & Messaging">
        <P>Team Hub includes an optional group chat for team personnel, parents, and — where a guardian approves via ParentGuard — supervised minor athletes. A team may have one main thread plus additional named channels; membership and oversight rules are enforced automatically. Messages, along with any photos, videos, or audio you share in chat, are visible to the other participants in that channel and are stored so the conversation syncs across devices. Media you share in chat is stored with our object-storage provider and served only to authorized participants; participants may download/save media they can already see. Coaches, staff, reps, and hub admins can also schedule a message to post at a later time.</P>
        <P>Chat is user-generated content and we do not tolerate objectionable content or abusive behavior. Before posting you must agree to our Community Guidelines; messages are screened for objectionable language, you can report a message or block another member, and any message that is repeatedly reported is automatically hidden pending review. When content is reported, administrators are notified by email so it can be reviewed and removed promptly if inappropriate. You can delete your own messages; team admins and administrators can remove any message and eject users who violate our terms, typically within 24 hours of a report. When you delete your account, your chat messages, reports, and blocks are removed.</P>
      </LegalSection>

      <LegalSection heading="11. Community Reviews">
        <P>CheerPlanner includes a Community Reviews directory where users can post ratings and reviews of places (such as restaurants, hotels, and gyms). Reviews you submit — including the star rating, your written comments, any photos you attach, the place and city, and the display name you choose (your first name and last initial, or "Anonymous") — are PUBLIC and visible to all CheerPlanner users across other accounts, independent of your household. Do not include sensitive personal information in a review.</P>
        <P>We do not tolerate objectionable content or abusive behavior. Before posting you must agree to our Community Guidelines; submissions are screened for objectionable language, you can report a review or block a reviewer, and content that is repeatedly reported is automatically hidden pending review. When a review is reported, administrators are notified by email so it can be reviewed and removed promptly if inappropriate. You can edit or delete your own reviews at any time, and we remove content and may eject users who violate our terms, typically within 24 hours of a report.</P>
      </LegalSection>

      <LegalSection heading="12. Location & Weather">
        <P>When a competition or event has a location and a date, we send that location text to our weather provider (Open-Meteo) to look up coordinates and retrieve a forecast to display in the app. We do not track your device's real-time GPS location for this feature; only the location text you entered for the event is used, and results are cached to reduce lookups.</P>
      </LegalSection>

      <LegalSection heading="13. Changes to This Policy">
        <P>We may update this Privacy Policy from time to time. Material changes will be reflected by updating the "Last updated" date above.</P>
      </LegalSection>

      <LegalSection heading="14. Contact Us">
        <P>CheerPlanner Support — Email: info@cheer-planner.com</P>
      </LegalSection>
    </StaticPage>
  );
}
