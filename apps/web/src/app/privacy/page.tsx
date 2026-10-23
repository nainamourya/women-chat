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
            <strong>Profile:</strong> your username, an optional bio and profile photo, and the interests you
            choose.
          </li>
          <li>
            <strong>Posts and activity:</strong> the photos and captions you post, your comments, the posts
            you like, and who you follow and who follows you. When you upload a photo we remove the location
            and camera details stored inside the file.
          </li>
          <li>
            <strong>Private messages:</strong> the text messages, and any posts you share, that you send to
            members who follow you back, with the time they were sent and whether they have been read.
          </li>
          <li>
            <strong>Notifications:</strong> a record of new followers, likes, comments and messages
            addressed to you, and whether you have opened them.
          </li>
          <li>
            <strong>Eligibility video:</strong> a short introduction video you upload, plus the review
            decision and, if rejected, a standard reason category.
          </li>
          <li>
            <strong>Random matches:</strong> who you were matched with and when, and the text messages you
            send in that chat.
          </li>
          <li>
            <strong>Reports and blocks:</strong> who you reported or blocked and when; for reports, the
            reason, any description you write, the post it is about (if any), and an optional image (JPEG,
            PNG or WebP, up to 5&nbsp;MB).
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
          <li>To run profiles, posts, the home feed, comments, likes, following and notifications, and to deliver private messages between members who follow each other.</li>
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
          <li>
            <strong>On GiiGirl:</strong> your username, display name, bio, profile photo, your numbers of
            posts, followers and following, your posts and photos, your comments, whether you liked a post,
            and the lists of who follows you and whom you follow are visible to other signed-in members whose
            eligibility has been verified. A member who has blocked you, or whom you have blocked, cannot see
            them.
          </li>
          <li>
            People who are not signed in cannot see your profile or posts, and photos are not available at
            public web addresses. Anyone who can see a photo could still save it or take a screenshot.
          </li>
          <li>
            Following needs no approval, and there are no private accounts at the moment. You cannot hide
            your profile from verified members other than by blocking them.
          </li>
          <li>
            <strong>Private messages</strong> can be read by you and the person you are writing to. They are
            not shown to other members.
          </li>
          <li>
            <strong>In a random match,</strong> the other member sees your display name and your bio (if you
            wrote one), sees and hears you during a call, and can read the messages you send them.
          </li>
          <li>
            Your email address, interests, eligibility video and notifications are not shown to other
            members.
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
          <li>Cloudflare R2, for private storage of eligibility videos until they are reviewed and deleted, and of profile photos and post images while they are on GiiGirl.</li>
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
            <strong>Posts, photos, comments, likes and follows:</strong> kept until you delete them, or until
            you delete your account. There is no automatic expiry.
          </li>
          <li>
            <strong>Private messages:</strong> kept in the conversation until the account of the member who
            sent them is deleted; there is no automatic deletion schedule. Messages you send remain in the
            other person&apos;s conversation after you delete your account, with their text replaced.
          </li>
          <li>
            <strong>Match chat messages, matches, reports and moderation records:</strong> there is no
            automatic deletion schedule. When an account is deleted its match chat messages are replaced,
            and reports about it that led to a moderation decision are kept.
          </li>
        </LegalList>
        <p>
          <Confirm>
            retention periods for private messages, chat messages, reports, report images and moderation
            records, and for backups. No period has been decided
          </Confirm>
        </p>
      </LegalSection>

      <LegalSection title="Your choices">
        <LegalList>
          <li>You can edit your username, display name, bio, profile photo and interests in your profile.</li>
          <li>You can delete your own posts and comments, remove your likes, and unfollow members.</li>
          <li>You can block members, report members and posts, and end any chat or call at any time.</li>
          <li>
            <strong>You can delete your account</strong> in Profile &rarr; Settings &rarr; Delete account.
            You confirm by typing a word and, if your account has a password, entering it. Deleting removes
            your username, profile photo, bio and interests, your posts and photos, comments, likes, follows,
            notifications, blocks, and any eligibility submission and video. Your email address and name are
            replaced with placeholders, your password is removed, and you are signed out and taken out of
            matchmaking. The messages you sent stay in other people&apos;s conversations with their text
            replaced, and reports about you that led to a moderation decision are kept. A placeholder
            account record remains so that moderation records stay consistent.
          </li>
          <li>
            You can ask us to correct your data.{" "}
            <Confirm>
              how such requests are made and handled: which contact or inbox, how identity is checked, and
              how quickly we respond. No process has been confirmed yet
            </Confirm>
          </li>
        </LegalList>
        <p>
          <Confirm>
            how long deleted data may remain in backups, how deletion requests from people who cannot sign
            in are handled, and which legal rights you will describe (access, correction, erasure,
            objection, complaint to a regulator)
          </Confirm>
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          We use measures such as hashed passwords, private storage for eligibility videos, profile photos
          and post images, access controls for our review team, and rate limiting against abuse. Photos and
          videos are not available at public web addresses.
        </p>
        <p>
          Private messages and posts are stored in our database in readable form. They are{" "}
          <strong>not end-to-end encrypted</strong>. No online service is perfectly secure, so we cannot
          guarantee absolute security.
        </p>
        <p>
          <Confirm>
            whether team members can read private message content when handling a report, and your process
            for notifying members after a data breach
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
