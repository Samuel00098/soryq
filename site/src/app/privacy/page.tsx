import type { Metadata } from 'next';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { site } from '@/lib/config';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: `How ${site.name} handles your data — local-first, bring-your-own-key.`,
  alternates: { canonical: '/privacy' },
};

const updated = 'June 14, 2026';
// NOTE: Reflects how Soryq works today (local-first, bring-your-own-key, no
// server-side routing of your data). Revisit if you add accounts, analytics, or
// a backend, and have counsel review before launch.

export default function PrivacyPage() {
  return (
    <>
      <Nav />

      <main className="legal">
        <header className="legal-head container">
          <span className="eyebrow">Legal</span>
          <h1 className="section-title">Privacy Policy</h1>
          <p className="updated">Last updated {updated}</p>
        </header>

        <article className="prose glass container">
          <p>
            {site.name} is built to be <strong>local-first</strong>. The app runs on your machine, and
            your projects, terminals, and editor content stay on your machine. This policy explains
            what limited data is involved and how it is handled.
          </p>

          <h2>Your work stays local</h2>
          <p>
            Your files, terminal sessions, command history, and editor content are processed locally
            on your device. {site.name} does not upload your code or project contents to our servers —
            we do not operate a backend that receives them.
          </p>

          <h2>API keys &amp; credentials</h2>
          <p>
            When you connect an AI provider, your API keys are stored in your operating system&apos;s
            secure keychain (Keychain on macOS, Credential Manager on Windows, the Secret Service on
            Linux). They are not transmitted to us. Requests to an AI provider are sent{' '}
            <strong>directly from your device</strong> to the provider you configured, under that
            provider&apos;s privacy policy.
          </p>

          <h2>AI provider data</h2>
          <p>
            When you use AI features, the prompt and context you choose to send (which may include
            snippets of your code) are sent to the third-party provider you selected. We do not see or
            store that data. Review your provider&apos;s privacy and data-retention terms to understand
            how they handle it. You can also run fully local models (e.g. Ollama or LM Studio), in
            which case nothing leaves your machine.
          </p>

          <h2>Updates</h2>
          <p>
            To deliver signed updates, {site.name} may contact an update service to check for new
            versions. This request includes standard technical information (such as the current app
            version and platform) needed to serve the correct update. It is not used to identify you.
          </p>

          <h2>This website</h2>
          <p>
            If you join the launch list or email us, we use the email address you provide solely to
            reply and to send the updates you asked for. We do not sell your personal information.
          </p>

          <h2>Children</h2>
          <p>
            {site.name} is not directed to children under 13, and we do not knowingly collect their
            data.
          </p>

          <h2>Changes to this policy</h2>
          <p>
            We may update this policy from time to time. When we do, we will revise the &quot;Last
            updated&quot; date above.
          </p>

          <h2>Contact</h2>
          <p>
            Questions about your privacy? Email us at{' '}
            <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>.
          </p>
        </article>
      </main>

      <Footer />
    </>
  );
}
