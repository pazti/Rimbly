export function OfflinePage() {
  return (
    <main className="inner-page">
      <section className="inner-page-intro">
        <p className="eyebrow">Connection needed</p>
        <h1>
          You’re offline.
          <span>Reconnect and try again.</span>
        </h1>
        <p className="inner-page-copy">
          Rimbly needs an internet connection to save your waitlist entry, contribution, or
          suggestion.
        </p>

        <div className="hero-actions" style={{ justifyContent: "flex-start", marginTop: "1.5rem" }}>
          <button className="primary-button" type="button" onClick={() => window.location.reload()}>
            Retry now
          </button>
          <a className="success-home-link" href="#/">
            Back to waitlist
          </a>
        </div>
      </section>
    </main>
  );
}
