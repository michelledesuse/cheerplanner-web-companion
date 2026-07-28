import React from "react";
import StaticPage, { LegalSection, P } from "@/src/components/StaticPage";

export default function PrivacyScreen() {
  return (
    <StaticPage title="Privacy Policy" subtitle="Last updated: July 21, 2026">
      <LegalSection>
        <P>CheerPlanner ("we," "our," or "us") is a mobile application that helps cheerleading families organize expenses, competition travel, schedules, and packing lists. This Privacy Policy explains how CheerPlanner collects, uses, and protects your information when you use the CheerPlanner mobile application and related services (the "Service"), and the choices you have. By creating an account and using CheerPlanner, you agree to the practices described in this policy.</P>
      </LegalSection>

      <LegalSection heading="1. Information We Collect">
        <P>We collect information you provide directly, including your name, email address, mobile phone number (if you opt in to SMS), and the household, athlete, competition, expense, payment, travel, and schedule details you enter into the app.</P>
        <P>We also collect basic technical data such as device type and app usage needed to operate the Service.</P>
        <P>If you use Team Hub (see below), you may also provide information about other people — such as team members, athletes, and their parents/guardians — including names, contact details, uniform/apparel sizes, paperwork completion status, and payment tracking notes. You may enter this manually or upload it by importing a spreadsheet (CSV or Excel) file.</P>
      </LegalSection>

      <LegalSection heading="2. Team Hub (for Coaches & Team Staff)">
        <P>Team Hub is an optional workspace for coaches, team reps, and staff to organize a team roster, sizes, paperwork, payment tracking, and volunteer sign-ups. Access is controlled by the account owner, who grants Team Hub access to specific people and can invite others by email.</P>
        <P>If you enter or upload information about other individuals, you are responsible for having the appropriate authority or consent to do so, and for using that information solely for legitimate team-management purposes. This data is visible only to household logins you have granted Team Hub access. If a person listed in your roster asks you to remove their information, you can delete it within the app.</P>
      </LegalSection>

      <LegalSection heading="3. Uploaded Files">
        <P>When you import a spreadsheet, we process the file only to extract the rows you choose to import and to create the corresponding records in your account. We do not use uploaded files for any other purpose.</P>
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
      </LegalSection>

      <LegalSection heading="7. Data Retention & Security">
        <P>We retain your information for as long as your account is active. You can delete your account and associated data at any time from Settings → Delete Account. We use industry standard measures to protect your data, though no method of transmission or storage is completely secure.</P>
      </LegalSection>

      <LegalSection heading="8. Your Choices">
        <P>You may update your notification preferences, opt out of SMS, or delete your account at any time within the app. To request access to or deletion of your data, contact us using the details below.</P>
      </LegalSection>

      <LegalSection heading="9. Children's Privacy">
        <P>CheerPlanner is intended for use by parents and guardians. It is not directed to children under 13, and we do not knowingly collect personal information directly from children.</P>
      </LegalSection>

      <LegalSection heading="10. Changes to This Policy">
        <P>We may update this Privacy Policy from time to time. Material changes will be reflected by updating the "Last updated" date above.</P>
      </LegalSection>

      <LegalSection heading="11. Contact Us">
        <P>CheerPlanner Support — Email: info@cheer-planner.com</P>
      </LegalSection>
    </StaticPage>
  );
}
