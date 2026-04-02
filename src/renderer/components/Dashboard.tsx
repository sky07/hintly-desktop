import React, { useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { SessionContext } from '../hooks/useWebSocket'

export interface SessionSettings {
  context: SessionContext
  provider: string
  promptKey: string
  verbosity: 'concise' | 'moderate' | 'detailed'
}

interface DashboardProps {
  onStartSession: (settings: SessionSettings) => void
  onLogout: () => void
}

export default function Dashboard({ onStartSession, onLogout }: DashboardProps) {
  const user = useAuthStore((s) => s.user)

  const [jobDescription, setJobDescription] = useState('')
  const [resume, setResume] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [roleType, setRoleType] = useState('software_engineer')
  const [roundType, setRoundType] = useState('behavioral')
  const [provider, setProvider] = useState('groq')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const handleStart = () => {
    onStartSession({
      context: {
        jobDescription,
        resume,
        workExperience: '',
        companyName,
        roleType,
        roundType,
      },
      provider,
      promptKey: 'personalized',
      verbosity: 'concise',
    })
  }

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-100">
              {user?.name || 'User'}
            </h2>
            <p className="text-[10px] text-gray-500">{user?.email}</p>
          </div>
          <button
            onClick={onLogout}
            className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Setup Form */}
      <div className="flex-1 px-4 pb-4 space-y-3">
        {/* Company & Role row */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-gray-400 mb-1 uppercase tracking-wider">Company</label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-[#0f0f23] border border-gray-700/50 rounded-md text-xs text-gray-100 focus:outline-none focus:border-purple-500/50 transition-colors placeholder:text-gray-600"
              placeholder="e.g. Google"
            />
          </div>
          <div>
            <label className="block text-[10px] text-gray-400 mb-1 uppercase tracking-wider">Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-[#0f0f23] border border-gray-700/50 rounded-md text-xs text-gray-100 focus:outline-none focus:border-purple-500/50 transition-colors"
            >
              <option value="groq">Groq</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Gemini</option>
              <option value="adaptive">Adaptive</option>
            </select>
          </div>
        </div>

        {/* Role type & Round type row */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-gray-400 mb-1 uppercase tracking-wider">Role Type</label>
            <select
              value={roleType}
              onChange={(e) => setRoleType(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-[#0f0f23] border border-gray-700/50 rounded-md text-xs text-gray-100 focus:outline-none focus:border-purple-500/50 transition-colors"
            >
              <option value="software_engineer">Software Engineer</option>
              <option value="senior_software_engineer">Senior SWE</option>
              <option value="senior_swe_l3_l5">Senior SWE (L3-L5)</option>
              <option value="data_scientist">Data Scientist</option>
              <option value="data_engineer">Data Engineer</option>
              <option value="machine_learning_engineer">ML Engineer</option>
              <option value="product_manager">Product Manager</option>
              <option value="technical_program_manager">TPM</option>
              <option value="engineering_manager">Eng Manager</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-gray-400 mb-1 uppercase tracking-wider">Round</label>
            <select
              value={roundType}
              onChange={(e) => setRoundType(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-[#0f0f23] border border-gray-700/50 rounded-md text-xs text-gray-100 focus:outline-none focus:border-purple-500/50 transition-colors"
            >
              <option value="behavioral">Behavioral</option>
              <option value="technical">Technical</option>
              <option value="system_design">System Design</option>
              <option value="screening">Screening</option>
              <option value="culture_fit">Culture Fit</option>
            </select>
          </div>
        </div>

        {/* Job Description */}
        <div>
          <label className="block text-[10px] text-gray-400 mb-1 uppercase tracking-wider">Job Description</label>
          <textarea
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-[#0f0f23] border border-gray-700/50 rounded-md text-xs text-gray-100 focus:outline-none focus:border-purple-500/50 transition-colors resize-none placeholder:text-gray-600"
            rows={3}
            placeholder="Paste job description here..."
          />
        </div>

        {/* Advanced toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
        >
          <svg className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          More options
        </button>

        {showAdvanced && (
          <div>
            <label className="block text-[10px] text-gray-400 mb-1 uppercase tracking-wider">Resume / Experience</label>
            <textarea
              value={resume}
              onChange={(e) => setResume(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-[#0f0f23] border border-gray-700/50 rounded-md text-xs text-gray-100 focus:outline-none focus:border-purple-500/50 transition-colors resize-none placeholder:text-gray-600"
              rows={3}
              placeholder="Paste resume or key experience..."
            />
          </div>
        )}

        {/* Start button */}
        <button
          onClick={handleStart}
          className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-purple-600/20"
        >
          Start Interview
        </button>

        <p className="text-[10px] text-gray-600 text-center">
          Ctrl+Shift+I to toggle visibility
        </p>
      </div>
    </div>
  )
}
