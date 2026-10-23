import type { Metadata } from "next";
import { Confirm, LegalList, LegalPage, LegalSection } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Community Guidelines",
  description: "How we keep GiiGirl a kind and safe space for women to talk.",
};

export default function GuidelinesPage() {
  return (
    <LegalPage
      current="/guidelines"
      title="Community Guidelines"
      intro="GiiGirl exists for genuine, welcoming conversation between adult women. These guidelines describe what that looks like and what happens when it does not."
    >
      <LegalSection title="Be real">
        <LegalList>
          <li>Use your own account, and keep one account only.</li>
          <li>
            Be honest about who you are. Do not impersonate other people or create a fake profile.
          </li>
          <li>
            GiiGirl is for adult women, 18 and over. Do not use it if you do not meet that, and do not try
            to get around eligibility verification.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Be kind">
        <LegalList>
          <li>No harassment, bullying, insults or hate towards anyone, including for who they are.</li>
          <li>No threats, intimidation or encouraging someone to hurt themselves or others.</li>
          <li>
            Respect it when someone ends a call or chat. Everyone can leave at any time, without
            explaining.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Keep it appropriate">
        <LegalList>
          <li>No nudity, sexual behaviour or sexually explicit talk on camera, in photos or captions, or in comments and messages.</li>
          <li>Only post photos you have the right to share. Do not post photos or personal details of other people without their consent.</li>
          <li>No illegal content or activity.</li>
          <li>No spam, advertising, scams or asking people for money.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Protect yourself and others">
        <LegalList>
          <li>
            Think before sharing personal details such as your full name, address, workplace or financial
            information.
          </li>
          <li>Do not record, screenshot or share someone&apos;s call or messages without their clear consent.</li>
          <li>Do not pressure anyone to move to another app or to meet in person.</li>
          <li>
            If you ever feel unsafe, end the call, block the person and report them. If you are in danger,
            contact your local emergency number.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Reporting and blocking">
        <p>
          You can end a call or chat, move on with &ldquo;Not for me&rdquo;, unfollow someone, block them, or
          report them. Blocking someone removes any follows between you, and they can no longer see your
          profile or posts, follow you or message you. You can report a member or a single post. Reports can
          be about harassment, sexual or inappropriate behaviour, someone who does not seem eligible, a fake
          profile, spam or scams, threatening or unsafe behaviour, or something else. You can add a
          description.
        </p>
        <p>
          Do not make reports that are knowingly false, malicious or abusive. Reports made honestly and in
          good faith are protected, even if we conclude that no rule was broken.
        </p>
      </LegalSection>

      <LegalSection title="What happens next">
        <p>
          Our team reviews reports. Depending on what happened, we may record a warning, suspend an account
          for a set time, or ban it permanently. Serious violations may lead to immediate suspension or a
          ban, subject to a fair review and appeal process once that process is defined.
        </p>
        <p>
          <Confirm>
            the appeal process: who reviews an appeal, how a member appeals, any time limits, and whether
            an account stays restricted while an appeal is pending
          </Confirm>
        </p>
        <p>
          <Confirm>
            how quickly reports are reviewed, whether members are told the outcome, and whether people can
            appeal a decision
          </Confirm>
        </p>
        <p>
          <Confirm>
            whether you will report illegal content or threats of serious harm to the police or other
            authorities, and under what circumstances (decide this with legal advice)
          </Confirm>
        </p>
      </LegalSection>

      <LegalSection title="Questions">
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
