// Step 29: the sign-in screen (AUTH=on and no session). The buttons go to the Builder API, which sends the
// person to GitHub or Google and back.
export function SignIn({ view }) {
  return (
    <main className="sign-in">
      <div className="sign-in-card">
        <h1>Sign in to AndarKaCode</h1>
        <p className="muted">Screenshots in, a working app out. The beta is invite-only: sign in with the account your invite went to.</p>
        {view.message && (
          <p className="sign-in-message" role="alert">
            {view.message}
          </p>
        )}
        <div className="sign-in-buttons">
          {view.buttons.map((b) => (
            <a key={b.provider} className="btn" href={b.href}>
              {b.label}
            </a>
          ))}
        </div>
      </div>
    </main>
  );
}
