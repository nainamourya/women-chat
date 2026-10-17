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
          GiiGirl is a space for adult women to meet one another for private, one-to-one conversation by
          text and video. You are paired with another eligible member who is available at that moment. It
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

      <LegalSection title="5. Acceptable use">
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

      <LegalSection title="6. Reports, blocking and enforcement">
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

      <LegalSection title="7. Your messages and content">
        <p>
          You are responsible for what you say and share. You keep ownership of your content. You give us
          permission to store and transmit it as needed to run GiiGirl, for example to deliver your
          messages to the person you are chatting with.
        </p>
        <p>
          <Confirm>
            whether you want a broader or narrower content licence than this, and how long messages are
            kept
          </Confirm>
        </p>
      </LegalSection>

      <LegalSection title="8. Safety">
        <p>
          GiiGirl is not an emergency service. If you are in danger, contact your local emergency number.
          Be careful about what you share with people you meet online, and use the End, Next, Block and
          Report options whenever something feels wrong.
        </p>
      </LegalSection>

      <LegalSection title="9. The service as it is">
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

      <LegalSection title="10. Ending your use of GiiGirl">
        <p>
          You can stop using GiiGirl at any time. We may suspend or end your access if you break these terms
          or the Community Guidelines.
        </p>
        <p>
          <Confirm>
            how a member can delete their account and data. An in-app delete option is not available yet,
            so decide whether to say &ldquo;email support@giigirl.com&rdquo; and how quickly you will act
          </Confirm>
        </p>
      </LegalSection>

      <LegalSection title="11. Changes, governing law and contact">
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
