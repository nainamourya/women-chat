import type { Metadata } from "next";
import { Confirm, LegalList, LegalPage, LegalSection } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What GiiGirl collects, why, who sees it, and how long we keep it.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      current="/privacy"
      title="Privacy Policy"
      intro="This page describes the personal information GiiGirl handles to run the service, based on how the product works today. We try to collect only what the service needs."
    >
      <LegalSection title="Who is responsible for your data">
        <p>
          <Confirm>
            the legal name and address of the operator, and the contact person for privacy questions or
            complaints (some countries require a named grievance or data-protection contact)
          </Confirm>
        </p>
        <p>
          Contact address:{" "}
          <a href="mailto:support@giigirl.com" className="underline hover:text-brand">
            support@giigirl.com
          </a>{" "}
          <Confirm>
            that support@giigirl.com is actively monitored by someone who will respond to privacy
            requests, and who that is. Until you confirm it, do not present it as a working support
            channel
          </Confirm>
        </p>
      </LegalSection>

      <LegalSection title="What we collect">
        <LegalList>
          <li>
            <strong>Account:</strong> your email address, display name, and a password (stored only as a
            one-way hash, never in plain text). If you sign in with Google, we store your Google account
            identifier and email, not your Google password or access tokens.
          </li>
          <li>
            <strong>Age confirmation:</strong> that you confirmed you are 18 or older at sign-up.
          </li>
          <li>
            <strong>Profile (optional):</strong> a short bio and the interests you choose.
          </li>
          <li>
            <strong>Eligibility video:</strong> a short introduction video you upload, plus the review
            decision and, if rejected, a standard reason category.
          </li>
          <li>
            <strong>Matches and messages:</strong> who you were matched with and when, and the text
            messages you send in a chat.
          </li>
          <li>
            <strong>Reports and blocks:</strong> who you reported or blocked and when; for reports, the
            reason, any description you write, and an optional image (JPEG, PNG or WebP, up to 5&nbsp;MB).
          </li>
          <li>
            <strong>Technical data:</strong> your IP address, used for security and rate limiting; a
            sign-in session cookie; and your light or dark theme choice, which stays in your browser.
          </li>
        </LegalList>
        <p>
          We do not record video or audio calls. We do not currently use advertising or analytics trackers.{" "}
          <Confirm>
            that this is still true at launch. If you add analytics, ad pixels or a cookie banner later,
            this page and the consent flow must be updated first
          </Confirm>
        </p>
      </LegalSection>

      <LegalSection title="How we use it">
        <LegalList>
          <li>To create and secure your account and sign you in.</li>
          <li>To review eligibility and decide who can be matched.</li>
          <li>To pair you with another member, run the chat and video call, and keep the conversation going if you reconnect.</li>
          <li>To handle reports and blocks, enforce our rules, and prevent abuse and spam.</li>
          <li>To keep the service working and respond to your questions.</li>
        </LegalList>
        <p>
          <Confirm>
            the legal basis or consent wording required in the countries you operate in (for example under
            India&apos;s Digital Personal Data Protection Act, the GDPR or similar laws). Do not claim
            compliance with any law until a lawyer has confirmed it
          </Confirm>
        </p>
      </LegalSection>

      <LegalSection title="What other members can see">
        <LegalList>
          <li>When you are matched, the other member sees your display name and your bio (if you wrote one).</li>
          <li>They see and hear you during a call and can read the messages you send them.</li>
          <li>
            Your email address, interests, eligibility video and other profile details are not shown to
            other members.
          </li>
          <li>
            To connect a call, devices exchange network addresses, so the person you are talking to could
            learn your IP address. Using a VPN is one way to reduce this.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Who we share data with">
        <p>
          We do not sell your personal information. We use service providers to run GiiGirl, and they handle
          data on our behalf:
        </p>
        <LegalList>
          <li>Cloudflare R2, for private storage of eligibility videos until they are reviewed and deleted.</li>
          <li>Google, if you choose Google sign-in, and for network-connection (STUN) help during calls.</li>
          <li>A relay (TURN) provider, when a direct video connection is not possible, so call media may pass through it.</li>
          <li>Hosting, database and caching providers that store account data, messages and short-lived queue data.</li>
        </LegalList>
        <p>
          <Confirm>
            the final list of providers and their countries (for example your web host, database, cache and
            TURN providers), and whether personal data is transferred outside your country
          </Confirm>
        </p>
        <p>
          We may also disclose information where the law requires it or to protect people&apos;s safety.{" "}
          <Confirm>how you will respond to police or court requests, and whether you will notify the affected member</Confirm>
        </p>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <LegalList>
          <li>
            <strong>Eligibility videos:</strong> deleted once a review decision is recorded. If deletion
            fails, our team retries it.
          </li>
          <li>
            <strong>Account and profile:</strong> kept while your account exists.
          </li>
          <li>
            <strong>Messages, matches, reports and moderation records:</strong> currently kept until the
            account is removed; there is no automatic deletion schedule yet.
          </li>
        </LegalList>
        <p>
          <Confirm>
            retention periods for chat messages, reports, report images and moderation records, and for
            backups. No period has been decided
          </Confirm>
        </p>
      </LegalSection>

      <LegalSection title="Your choices">
        <LegalList>
          <li>You can edit your display name, bio and interests in your profile.</li>
          <li>You can block members and end any chat or call at any time.</li>
          <li>
            You can ask us to correct or delete your data.{" "}
            <Confirm>
              how such requests are made and handled: which contact or inbox, how identity is checked, and
              how quickly we respond. No process has been confirmed yet
            </Confirm>
          </li>
        </LegalList>
        <p>
          <Confirm>
            the account-deletion process and timeline (an in-app delete option does not exist yet), what
            happens to messages you sent and to reports about you, and which legal rights you will describe
            (access, correction, erasure, objection, complaint to a regulator)
          </Confirm>
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          We use measures such as hashed passwords, private storage for eligibility videos, access controls
          for our review team, and rate limiting against abuse. No online service is perfectly secure, so we
          cannot guarantee absolute security.
        </p>
        <p>
          <Confirm>
            whether team members can read chat message content when handling a report, and your process for
            notifying members after a data breach
          </Confirm>
        </p>
      </LegalSection>

      <LegalSection title="Children">
        <p>
          GiiGirl is intended only for adults aged 18 and over. If we become aware that an account belongs
          to someone under 18, we may suspend access and review the data associated with that account in
          accordance with applicable requirements.
        </p>
        <p>
          <Confirm>
            the exact handling and deletion procedure for under-18 accounts: what data is deleted, when,
            who decides, and who is notified
          </Confirm>
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>We will post any update to this policy here with a new date.</p>
      </LegalSection>
    </LegalPage>
  );
}
