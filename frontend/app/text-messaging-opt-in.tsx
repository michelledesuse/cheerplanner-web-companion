import React from "react";
import StaticPage, { LegalSection, P } from "@/src/components/StaticPage";

export default function TextMessagingOptInScreen() {
  return (
    <StaticPage title="Text Messaging Opt-In" subtitle="CheerPlanner SMS reminder program">
      <LegalSection>
        <P>CheerPlanner offers optional SMS text-message reminders to help cheer families and team staff stay on top of deadlines. Enrollment is entirely optional and requires your explicit opt-in.</P>
      </LegalSection>

      <LegalSection heading="Program description">
        <P>If you opt in, we use your mobile number solely to send you account-related reminder text messages — such as payment due dates, upcoming competitions, travel deadlines, and other reminders you enable in the app.</P>
      </LegalSection>

      <LegalSection heading="How to opt in">
        <P>You opt in by adding your mobile number and enabling SMS reminders in the CheerPlanner app under Settings → Notifications. Consent to receive text messages is not a condition of purchasing or using the Service.</P>
      </LegalSection>

      <LegalSection heading="Message frequency">
        <P>Message frequency varies based on your activity and the reminders you enable. Message and data rates may apply.</P>
      </LegalSection>

      <LegalSection heading="How to opt out & get help">
        <P>You can opt out at any time by replying STOP to any message, or by turning off SMS reminders in Settings → Notifications. Reply HELP for help, or email us at info@cheer-planner.com.</P>
      </LegalSection>

      <LegalSection heading="Privacy">
        <P>Mobile information (including your phone number) is used only to deliver the reminders you request. We do not sell, rent, or share your mobile opt-in data or phone number with third parties or affiliates for their own marketing purposes. Message delivery is handled by our SMS provider (Twilio) strictly to transmit your reminders. See our Privacy Policy for full details.</P>
      </LegalSection>
    </StaticPage>
  );
}
