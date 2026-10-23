import type { Metadata } from "next";
import { Confirm, LegalList, LegalPage, LegalSection } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The rules for using GiiGirl, a women-only space for one-to-one conversation.",
};

export default function TermsPage() {
  return (
    <LegalPage
      current="/terms"
      title="Terms of Service"
      intro="These terms explain what you can expect from GiiGirl and what we expect from you. They apply together with our Privacy Policy and Community Guidelines."
    >
      <LegalSection title="Accepting these terms">
        <p>
          <Confirm>
            how members accept the Terms of Service and Privacy Policy when they create an account. This is
            not implemented yet. Proposed: an unchecked checkbox at sign-up (&ldquo;I agree to the Terms of
            Service and Privacy Policy&rdquo;) that links to both pages, with the accepted policy version
            and the time of acceptance recorded for each member. Until that exists, these pages should not
            be presented as an agreement the member has already made
          </Confirm>
        </p>
      </LegalSection>

      <LegalSection title="1. What GiiGirl is">
        <p>
          GiiGirl is a space for adult women to connect. You can be paired with another eligible member for
          a private one-to-one video call and chat, and you can keep a profile, follow other members, share
          photos and posts, like and comment, and send private messages to members who follow you back. It
          is not a dating service.
        </p>
        <p>
          <Confirm>
            the legal name of the company or person that operates GiiGirl, its registered address, and
            whether it is a company, partnership or sole proprietorship
          </Confirm>
        </p>
      </LegalSection>

      <LegalSection title="2. Who can use GiiGirl">
        <LegalList>
          <li>You must be at least 18 years old. When you sign up, you confirm that you are 18 or older.</li>
          <li>
            GiiGirl is intended for women. Access to matching depends on completing eligibility
            verification (section 3).
          </li>
          <li>You may hold only one account, and the details you give us must be truthful.</li>
        </LegalList>
        <p>
          <Confirm>
            the exact wording of the women-only eligibility rule, and whether it needs to be adjusted for
            anti-discrimination law in the countries you will operate in (for example, how transgender or
            non-binary people are treated)
          </Confirm>
        </p>
      </LegalSection>

      <LegalSection title="3. Eligibility verification">
        <p>
          Before you can be matched, you record a short introduction video. A member of our team reviews it
          and decides whether to approve it. We delete the video once a decision has been recorded; if the
          automatic deletion fails, our team retries it.
        </p>
        <LegalList>
          <li>
            This review is not a government-ID or legal age check, and the 18+ confirmation is a
            self-declaration.
          </li>
          <li>
            We may approve, reject or ask you to resubmit. Your eligibility may be revoked if verification
            fails, or where there are reasonable grounds relating to safety, eligibility, or compliance
            with these terms and the Community Guidelines.
          </li>
          <li>
            We do not guarantee that every member is a woman or an adult, or that anyone you meet is who
            they say they are.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="4. Matching and video calls">
        <LegalList>
          <li>
            When you choose &ldquo;Find Someone&rdquo;, GiiGirl asks your browser for access to your camera
            and microphone, adds you to a waiting list, and pairs you with another eligible member who is
            waiting.
          </li>
          <li>
            Once paired, a video call starts automatically. You can turn your camera or microphone off, end
            the call, or move on to someone else at any time.
          </li>
          <li>
            Video and audio travel directly between members where possible, or through a relay service when
            a direct connection is not possible. GiiGirl does not record calls.
          </li>
          <li>
            The other member could still record or screenshot a call using their own device. Do not share
            anything you would not want kept.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="5. Profiles, posts, comments and messages">
        <LegalList>
          <li>
            <strong>Your profile.</strong> You choose a username. Your username, display name, bio (if you
            write one) and profile photo (if you add one) are shown to other members.
          </li>
          <li>
            <strong>Who can see your content.</strong> Your profile, posts, photos, comments, likes and the
            lists of who follows you and whom you follow can be seen by other signed-in GiiGirl members whose
            eligibility has been verified. They are not shown to people who are not signed in, and photos are
            not available at public web addresses. A member you have blocked, or who has blocked you, cannot
            see them. Anyone who can see a photo can still save it or take a screenshot.
          </li>
          <li>
            <strong>Following.</strong> Following a member does not need their approval, and there are no
            private accounts at the moment.
          </li>
          <li>
            <strong>Photos.</strong> You may upload JPEG, PNG or WebP photos. Location and camera details
            stored inside a photo file are removed when it is uploaded. Only post photos you have the right
            to share.
          </li>
          <li>
            <strong>Private messages.</strong> Two members can message each other only while they follow each
            other, and neither has blocked the other. If one of you unfollows or blocks the other, new
            messages stop, and earlier messages stay in the conversation.
          </li>
          <li>
            <strong>Messages are not end-to-end encrypted.</strong> They are stored on our servers in
            readable form so that they can be delivered and shown to you.
          </li>
        </LegalList>
        <p>
          <Confirm>
            whether you will offer private accounts or follow requests before launch (neither exists today),
            and whether the team may read private messages when reviewing a report
          </Confirm>
        </p>
      </LegalSection>

      <LegalSection title="6. Acceptable use">
        <p>
          You must follow our{" "}
          <a href="/guidelines" className="underline hover:text-brand">
            Community Guidelines
          </a>
          . You must not use GiiGirl to harass, threaten, deceive or exploit anyone, to share sexual or
          illegal content, to advertise or scam, to make knowingly false, malicious or abusive reports, or
          to try to break or bypass the service, including its eligibility checks.
        </p>
      </LegalSection>

      <LegalSection title="7. Reports, blocking and enforcement">
        <p>
          You can report or block another member. We review reports and may issue a warning, suspend an
          account for a period, or ban it permanently. We may keep records of reports and decisions.
        </p>
        <p>
          GiiGirl may restrict, suspend or terminate an account for safety reasons, eligibility reasons or
          violations of these terms and the Community Guidelines. Where there is an urgent safety concern,
          we may do so without prior notice.
        </p>
        <p>
          <Confirm>
            whether members can appeal a suspension or ban, how, and how quickly you commit to review
            reports
          </Confirm>
        </p>
      </LegalSection>

      <LegalSection title="8. Your posts, photos and messages">
        <p>
          You are responsible for what you post, comment and send. You keep ownership of your content. You
          give us permission to store, display and transmit it as needed to run GiiGirl, for example to show
          your post to other members or to deliver your message to the person you are writing to. Content you
          delete is removed as described in the Privacy Policy.
        </p>
        <p>
          <Confirm>
            whether you want a broader or narrower content licence than this, and how long messages are
            kept
          </Confirm>
        </p>
      </LegalSection>

      <LegalSection title="9. Safety">
        <p>
          GiiGirl is not an emergency service. If you are in danger, contact your local emergency number.
          Be careful about what you share with people you meet online, and use the End, Next, Block and
          Report options whenever something feels wrong.
        </p>
      </LegalSection>

      <LegalSection title="10. The service as it is">
        <p>
          GiiGirl is early-stage software. We may change, pause or stop features, and we do not promise that
          the service will always be available, error-free, or that a video call will connect on every
          network.
        </p>
        <p>
          <Confirm>
            the disclaimer of warranties and limit of liability, which depend on your country&apos;s law
            and should be written by a lawyer
          </Confirm>
        </p>
      </LegalSection>

      <LegalSection title="11. Ending your use of GiiGirl and deleting your account">
        <p>
          You can stop using GiiGirl at any time. We may suspend or end your access if you break these terms
          or the Community Guidelines.
        </p>
        <p>
          You can delete your account yourself in Profile &rarr; Settings &rarr; Delete account. You confirm
          by typing a word and, if your account has a password, entering it. Deleting your account is
          permanent: it removes your profile, photos, posts, comments, likes and follows, and signs you out.
          The Privacy Policy explains exactly what is removed and what may be kept.
        </p>
        <p>
          <Confirm>
            how someone who can no longer sign in can ask for their account to be deleted (for example by
            email to the support address, once you have confirmed it is monitored), how quickly you will act,
            and how long deleted data may remain in backups
          </Confirm>
        </p>
      </LegalSection>

      <LegalSection title="12. Changes, governing law and contact">
        <p>
          We may update these terms and will post the new version here with a new date.
        </p>
        <p>
          <Confirm>
            how members are told about material changes to these terms, and how acceptance of an updated
            version is recorded
          </Confirm>
        </p>
        <p>
          <Confirm>governing law, courts or arbitration venue, and how disputes are handled</Confirm>
        </p>
        <p>
          Contact address:{" "}
          <a href="mailto:support@giigirl.com" className="underline hover:text-brand">
            support@giigirl.com
          </a>{" "}
          <Confirm>
            that support@giigirl.com is actively monitored by someone who will respond. Until you confirm
            it, do not present it as a working support channel
          </Confirm>
        </p>
      </LegalSection>
    </LegalPage>
  );
}
