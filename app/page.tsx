const features = [
  {
    title: '章节总结',
    description: '翻开之前，先看清全貌，再决定从哪里慢下来。',
  },
  {
    title: '段落解读',
    description: '把艰涩的句子拆开，讲清它真正想说的话。',
  },
  {
    title: '问答应答',
    description: '关于正在读的内容，什么都可以问，不必怕问得浅。',
  },
  {
    title: '概念地图',
    description: '看一个念头如何牵动整本书，让线索彼此照见。',
  },
  {
    title: '深度思考',
    description: '越过纸面，追问那些值得带走的问题。',
  },
];

export default function Home() {
  return (
    <main className="page">
      <section className="hero" aria-labelledby="deer-title">
        <p className="eyebrow">轻轻读，深深懂</p>
        <h1 id="deer-title">Deer</h1>
        <p className="lead">
          温和的 AI 阅读伙伴。带一页纸、一章书，或者一个问题来就好。
        </p>
        <a className="cta" href="#features">
          看看 Deer 能做什么
        </a>
      </section>

      <section id="features" className="features" aria-label="Deer 的能力">
        {features.map((feature) => (
          <article key={feature.title} className="card">
            <h2>{feature.title}</h2>
            <p>{feature.description}</p>
          </article>
        ))}
      </section>

      <section className="quote" aria-label="Deer 的话">
        <blockquote>
          我不替你读书。我帮你读得更好，想得更远，也享受这段旅程。
        </blockquote>
      </section>
    </main>
  );
}
