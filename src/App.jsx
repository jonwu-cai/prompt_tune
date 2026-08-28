import { useState } from 'react'

const MODEL = 'launch-quantized-replacement'
const FREQUENCY_PENALTY = 1.5

const DEFAULT_CHARACTER_SYSTEM = `Given a description, generate all the fields create a character.

Fields to generate:
- name: handle/username (max 20 characters).
- title: A super short tagline that makes the relationship or conflict clear and creates curiosity by suggesting an unfinished story (max 50 characters).
- description: Write a description that clearly summarizes their role, personality, behavior toward the user, motivation, relationship, and only relevant backstory or appearance.
- greeting: Write an opening greeting that starts mid-scene, shows their personality, establishes the user's role and immediate conflict, and ends with a clear prompt for the user to respond.
- additional_greetings: Write an opening greeting that starts mid-scene, shows their personality, establishes the user's role and immediate conflict, and ends with a clear prompt for the user to respond (1-3 items).
- tags: 2-5 relevant tag strings.
- avatar_generation_prompt: Describe what the character looks like.`

const DEFAULT_DEFINITION_SYSTEM = `Given a description, generate all the fields create a character.

Fields to generate:
- personality: Core traits, temperament, and how the character behaves.
- relationship_with_user: How the character feels about and treats {{user}}.
- rules: Strict rules for how {{char}} must respond to {{user}} (boundaries, must-dos, must-nots).
- goals: What the character wants; a motivation or conflict.
- examples: Conversation examples between user and char i.e."{{user}}: Hello / {{char}}: Hi there / {{user}}: How are you?".
`

const CHARACTER_SCHEMA = {
  name: 'generate_character',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string', maxLength: 20 },
      title: { type: 'string', maxLength: 50 },
      description: { type: 'string' },
      greeting: { type: 'string' },
      additional_greetings: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 3,
      },
      tags: { type: 'array', items: { type: 'string' } },
      avatar_generation_prompt: { type: 'string' },
    },
    required: [
      'name',
      'title',
      'description',
      'greeting',
      'additional_greetings',
      'tags',
      'avatar_generation_prompt',
    ],
  },
}

const DEFINITION_SCHEMA = {
  name: 'generate_definition',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      personality: { type: 'string' },
      relationship_with_user: { type: 'string' },
      rules: { type: 'array', items: { type: 'string' } },
      goals: { type: 'string' },
      examples: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: 3,
      },
    },
    required: ['personality', 'relationship_with_user', 'rules', 'goals', 'examples'],
  },
}

async function generate({ url, apiKey, system, userPrompt, jsonSchema }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      frequency_penalty: FREQUENCY_PENALTY,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPrompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: jsonSchema,
      },
    }),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}\n${text}`)
  }

  const data = JSON.parse(text)
  const content = data?.choices?.[0]?.message?.content ?? text
  try {
    return JSON.parse(content)
  } catch {
    return content
  }
}

function toCell(value) {
  if (value == null) return ''
  if (Array.isArray(value)) return value.join('\n')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function escapeCsv(cell) {
  return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
}

function exportToExcel(title, results) {
  const fieldKeys = []
  for (const r of results) {
    if (r.data && typeof r.data === 'object' && !Array.isArray(r.data)) {
      for (const k of Object.keys(r.data)) {
        if (!fieldKeys.includes(k)) fieldKeys.push(k)
      }
    }
  }

  const headers = ['description', ...fieldKeys, 'error']
  const rows = results.map((r) => {
    const cells = [r.description, ...fieldKeys.map((k) => (r.data ? r.data[k] : '')), r.error]
    return cells.map((c) => escapeCsv(toCell(c))).join(',')
  })

  const csv = '﻿' + [headers.map(escapeCsv).join(','), ...rows].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title.toLowerCase()}-results.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function highlightJson(json) {
  const escaped = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'json-number'
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'json-key' : 'json-string'
      } else if (/true|false/.test(match)) {
        cls = 'json-boolean'
      } else if (/null/.test(match)) {
        cls = 'json-null'
      }
      return `<span class="${cls}">${match}</span>`
    },
  )
}

function Output({ data }) {
  if (data == null) return null

  if (typeof data !== 'object') {
    return <pre className="output">{String(data)}</pre>
  }

  const json = JSON.stringify(data, null, 2)
  return (
    <pre
      className="output json"
      dangerouslySetInnerHTML={{ __html: highlightJson(json) }}
    />
  )
}

function Section({ title, requestUrl, apiKey, defaultSystem, jsonSchema }) {
  const [system, setSystem] = useState(defaultSystem)
  const [descriptions, setDescriptions] = useState(['A wise ancient wizard'])
  const [results, setResults] = useState(null)
  const [activeTab, setActiveTab] = useState(0)
  const [loading, setLoading] = useState(false)

  function updateDescription(index, value) {
    setDescriptions((prev) => prev.map((d, i) => (i === index ? value : d)))
  }

  function addDescription() {
    setDescriptions((prev) => [...prev, ''])
  }

  function removeDescription(index) {
    setDescriptions((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleGenerate() {
    setLoading(true)
    setResults(null)
    setActiveTab(0)

    const settled = await Promise.all(
      descriptions.map(async (description) => {
        const userPrompt = `Description: ${description}`
        try {
          const data = await generate({ url: requestUrl, apiKey, system, userPrompt, jsonSchema })
          return { description, data, error: null }
        } catch (e) {
          return { description, data: null, error: e.message }
        }
      }),
    )

    setResults(settled)
    setLoading(false)
  }

  return (
    <section className="card">
      <h2>{title}</h2>

      <label>System prompt</label>
      <textarea
        rows={10}
        value={system}
        onChange={(e) => setSystem(e.target.value)}
      />

      <div className="prompt-header">
        <label>User prompts — descriptions</label>
        <button
          type="button"
          className="add-btn"
          onClick={addDescription}
          title="Add another prompt"
        >
          + Add
        </button>
      </div>

      {descriptions.map((description, i) => (
        <div className="prompt-row" key={i}>
          <input
            type="text"
            value={description}
            onChange={(e) => updateDescription(i, e.target.value)}
            placeholder="A wise ancient wizard"
          />
          {descriptions.length > 1 && (
            <button
              type="button"
              className="remove-btn"
              onClick={() => removeDescription(i)}
              title="Remove this prompt"
            >
              ×
            </button>
          )}
        </div>
      ))}

      <button
        className="generate-btn"
        onClick={handleGenerate}
        disabled={loading || !apiKey || !requestUrl}
      >
        {loading ? 'Generating…' : `Generate (${descriptions.length})`}
      </button>
      {(!apiKey || !requestUrl) && (
        <div className="hint">Enter the Request URL and VLLM_API_KEY above to generate.</div>
      )}

      {results && (
        <div className="results-panel">
          <div className="results-header">
            <button
              type="button"
              className="export-btn"
              onClick={() => exportToExcel(title, results)}
            >
              Export to Excel
            </button>
          </div>
          {results.length > 1 && (
            <div className="tabs">
              {results.map((r, i) => (
                <button
                  key={i}
                  className={`tab ${i === activeTab ? 'active' : ''}`}
                  onClick={() => setActiveTab(i)}
                >
                  {r.error ? '⚠ ' : ''}
                  {r.description ? r.description.slice(0, 24) : `Prompt ${i + 1}`}
                </button>
              ))}
            </div>
          )}
          {results[activeTab] &&
            (results[activeTab].error ? (
              <pre className="output error">{results[activeTab].error}</pre>
            ) : (
              <Output data={results[activeTab].data} />
            ))}
        </div>
      )}
    </section>
  )
}

export default function App() {
  const [apiKey, setApiKey] = useState('')
  const [requestUrl, setRequestUrl] = useState('')

  return (
    <div className="app">
      <h1>Prompt Tune</h1>

      <div className="apikey">
        <label>Request URL *</label>
        <input
          type="text"
          value={requestUrl}
          onChange={(e) => setRequestUrl(e.target.value)}
          placeholder="Request URL"
        />
      </div>

      <div className="apikey">
        <label>VLLM_API_KEY *</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Bearer token"
        />
      </div>

      <Section
        title="Character"
        requestUrl={requestUrl}
        apiKey={apiKey}
        defaultSystem={DEFAULT_CHARACTER_SYSTEM}
        jsonSchema={CHARACTER_SCHEMA}
      />

      <Section
        title="Definition"
        requestUrl={requestUrl}
        apiKey={apiKey}
        defaultSystem={DEFAULT_DEFINITION_SYSTEM}
        jsonSchema={DEFINITION_SCHEMA}
      />
    </div>
  )
}
