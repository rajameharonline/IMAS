// Payment Gateways সেটআপ পেজ — ১৪টি গেটওয়ে, gateway type অনুযায়ী dynamic fields
import { useState, useEffect, useCallback } from 'react'
import api from '../../utils/api'
import toast from 'react-hot-toast'

/* ── Gateway sidebar list ───────────────────────────────────────────────── */
const GATEWAYS = [
  { key: 'sslcommerz',     label: 'SSLCommerz',     color: '#0066cc' },
  { key: 'bkash',          label: 'bKash',           color: '#e2136e' },
  { key: 'nagad',          label: 'Nagad',           color: '#f7941d' },
  { key: 'aamarpay',       label: 'aamarPay',        color: '#e63946' },
  { key: 'shurjopay',      label: 'shurjoPay',       color: '#6a0dad' },
  { key: 'fosterpayments', label: 'FosterPayments',  color: '#2a9d8f' },
  { key: 'walletmix',      label: 'Walletmix',       color: '#3a86ff' },
  { key: 'phonepe',        label: 'PhonePe',         color: '#5f0a87' },
  { key: 'razorpay',       label: 'Razorpay',        color: '#072654' },
  { key: 'rocket',         label: 'Rocket',          color: '#8e24aa' },
  { key: 'stripe',         label: 'Stripe',          color: '#635bff' },
  { key: 'easypayment',    label: 'EasyPayment',     color: '#00897b' },
  { key: 'webhook',        label: 'Webhook',         color: '#546e7a' },
  { key: 'paybill',        label: 'Paybill',         color: '#0288d1' },
]

/* ── প্রতিটি gateway-এর type options ──────────────────────────────────── */
const GW_TYPES = {
  bkash: [
    { value: 'bkash_tokenized',    label: 'bKash Tokenized API (Web/URL) Payment' },
    { value: 'bkash_checkout',     label: 'bKash Checkout API (Popup) Payment' },
    { value: 'platform_connector', label: 'Platform Connector (Real Time Pull)' },
  ],
  nagad: [
    { value: 'nagad_api',          label: 'Nagad Direct Merchant API' },
    { value: 'nagad_tokenized',    label: 'Nagad Tokenized Payment' },
  ],
  sslcommerz: [
    { value: 'ssl_standard',       label: 'SSLCommerz Standard (Hosted)' },
    { value: 'ssl_seamless',       label: 'SSLCommerz Seamless Integration' },
  ],
  aamarpay:       [{ value: 'aamarpay_pgw',      label: 'aamarPay Payment Gateway' }],
  shurjopay:      [{ value: 'shurjopay_pgw',     label: 'shurjoPay Payment Gateway' }],
  fosterpayments: [{ value: 'api_integration',   label: 'FosterPayments API' }],
  walletmix:      [{ value: 'api_integration',   label: 'Walletmix API' }],
  phonepe:        [{ value: 'api_integration',   label: 'PhonePe API' }],
  razorpay: [
    { value: 'razorpay_standard',  label: 'Razorpay Standard Checkout' },
    { value: 'api_integration',    label: 'Razorpay API Integration' },
  ],
  rocket:         [{ value: 'platform_connector', label: 'Platform Connector (Real Time Pull)' }],
  stripe: [
    { value: 'stripe_checkout',    label: 'Stripe Checkout' },
    { value: 'stripe_elements',    label: 'Stripe Elements' },
  ],
  easypayment:    [{ value: 'api_integration',   label: 'EasyPayment API' }],
  webhook:        [{ value: 'webhook_receiver',  label: 'Webhook Receiver' }],
  paybill:        [{ value: 'pgw',               label: 'Paybill Payment Gateway' }],
}

/* ── কোন type-এ কোন extra fields দেখাবে ──────────────────────────────── */
// API_KEYS_TYPES = App Key + App Secret + Sandbox/Live দেখাবে
const API_KEYS_TYPES = new Set([
  'bkash_tokenized', 'bkash_checkout',
  'nagad_tokenized',
  'ssl_standard', 'ssl_seamless',
  'aamarpay_pgw', 'shurjopay_pgw',
  'stripe_checkout', 'stripe_elements',
  'razorpay_standard', 'api_integration',
  'fosterpayments_api', 'pgw',
])
// MERCHANT_TYPES = Merchant Number দেখাবে
const MERCHANT_TYPES = new Set([
  'platform_connector', 'nagad_api', 'webhook_receiver',
])

const showSandboxLive   = type => API_KEYS_TYPES.has(type)
const showAppKeys       = type => API_KEYS_TYPES.has(type)
const showMerchantNum   = type => MERCHANT_TYPES.has(type) || (!API_KEYS_TYPES.has(type) && !MERCHANT_TYPES.has(type))

/* ── Style constants ────────────────────────────────────────────────────── */
const INP = 'w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1d435d] focus:border-[#1d435d] bg-white'
const LBL = 'block text-sm font-semibold text-gray-700 mb-1'
const REQ = <span className="text-red-500 ml-0.5">*</span>

/* ── Gateway Avatar ─────────────────────────────────────────────────────── */
function GatewayAvatar({ label, color, active, size = 28 }) {
  const initials = label.slice(0, 2).toUpperCase()
  return (
    <span
      className="inline-flex items-center justify-center rounded font-bold text-white shrink-0"
      style={{
        background: active ? 'rgba(255,255,255,0.2)' : color,
        width: size, height: size,
        fontSize: size * 0.38,
      }}
    >
      {initials}
    </span>
  )
}

/* ── Password input with toggle ─────────────────────────────────────────── */
function PasswordInput({ value, onChange, placeholder = 'Password' }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        className={`${INP} pr-10`}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
      />
      <button
        type="button"
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        onClick={() => setShow(p => !p)}
      >
        {show ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        )}
      </button>
    </div>
  )
}

/* ── মূল component ──────────────────────────────────────────────────────── */
export default function PaymentGatewaysPage() {
  const [gatewayData, setGatewayData] = useState({})
  const [selected,    setSelected]    = useState('bkash')
  const [form,        setForm]        = useState({})
  const [saving,      setSaving]      = useState(false)
  const [loading,     setLoading]     = useState(true)

  /* ── Load all gateways ─────────────────────────────────────────────────── */
  const loadGateways = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/system/payment-gateways/all/')
      const map = {}
      data.forEach(g => { map[g.gateway] = g })
      setGatewayData(map)
    } catch {
      toast.error('Gateway data load করতে সমস্যা হয়েছে।')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadGateways() }, [loadGateways])

  /* ── selected gateway পরিবর্তনে form sync ─────────────────────────────── */
  useEffect(() => {
    const gw = gatewayData[selected]
    if (!gw) return

    // এই gateway-এর default type
    const types = GW_TYPES[selected] || []
    const defaultType = types[0]?.value || 'platform_connector'

    setForm({
      gateway:          gw.gateway,
      gateway_type:     gw.gateway_type || defaultType,
      sandbox_live:     gw.sandbox_live  || 'sandbox',
      app_key:          gw.app_key        || '',
      app_secret_plain: gw.app_secret_plain || '',
      merchant_number:  gw.merchant_number  || '',
      payment_url:      (gw.config || {}).payment_url || '',
      username:         gw.username         || '',
      password_plain:   gw.password_plain   || '',
      is_active:        gw.is_active         ?? false,
      activation_date:  gw.activation_date   || '',
      expiry_date:      gw.expiry_date        || '',
      applicable_admin_portal:   gw.applicable_admin_portal   ?? false,
      applicable_pop_portal:     gw.applicable_pop_portal     ?? false,
      applicable_bandwidth_pop:  gw.applicable_bandwidth_pop  ?? false,
      applicable_pop_client:     gw.applicable_pop_client     ?? false,
    })
  }, [selected, gatewayData])

  const setField = (name, value) => setForm(p => ({ ...p, [name]: value }))

  /* ── Save or Update ──────────────────────────────────────────────────────── */
  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const { payment_url, ...restForm } = form;
      // খালি date string → null (API-তে YYYY-MM-DD বা null চাই, '' নয়)
      const payload = {
        ...restForm,
        gateway:          selected,
        activation_date:  restForm.activation_date  || null,
        expiry_date:      restForm.expiry_date       || null,
        config: { ...(gwConfig?.config || {}), payment_url: payment_url || '' },
      };
      await api.patch('/system/payment-gateways/by-gateway/', payload)
      const label = GATEWAYS.find(g => g.key === selected)?.label
      toast.success(`${label} সেটিংস সংরক্ষিত হয়েছে।`)
      await loadGateways()
    } catch (err) {
      const errMsg = err?.response?.data
        ? Object.values(err.response.data).flat().join(' ')
        : 'সংরক্ষণ ব্যর্থ হয়েছে।'
      toast.error(errMsg)
    } finally {
      setSaving(false)
    }
  }

  const selectedGW  = GATEWAYS.find(g => g.key === selected)
  const gwConfig    = gatewayData[selected]
  const typeOptions = GW_TYPES[selected] || [{ value: form.gateway_type, label: form.gateway_type }]
  const curType     = form.gateway_type || ''

  /* ── field visibility ─────────────────────────────────────────────────── */
  const hasSandbox  = showSandboxLive(curType)
  const hasAppKeys  = showAppKeys(curType)
  const hasMerchant = showMerchantNum(curType) && !hasAppKeys

  return (
    <div className="min-h-screen bg-gray-100 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="bg-[#173d59] text-white rounded p-1.5">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
              <path fillRule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-800">Payment Gateways</h1>
            <p className="text-xs text-gray-500">Setting Up Payment Gateways</p>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-1 text-xs text-gray-500">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
          </svg>
          <span>System</span><span>&gt;</span>
          <span className="text-gray-700 font-medium">Payment Gateways</span>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
          <svg className="animate-spin w-5 h-5 mr-2 text-[#173d59]" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          লোড হচ্ছে...
        </div>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          {/* ── Left: Gateway List ─────────────────────────────────────────── */}
          <div className="w-full shrink-0 lg:w-44">
            <div className="grid grid-cols-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden sm:grid-cols-3 lg:block">
              {GATEWAYS.map(gw => {
                const isActive = !!gatewayData[gw.key]?.is_active
                const isSel    = selected === gw.key
                return (
                  <button
                    key={gw.key}
                    onClick={() => setSelected(gw.key)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium transition-colors border-b border-gray-100 last:border-0 text-left
                      ${isSel ? 'bg-[#173d59] text-white' : 'text-gray-700 hover:bg-gray-50'}`}
                  >
                    <GatewayAvatar label={gw.label} color={gw.color} active={isSel} size={28} />
                    <span className="truncate flex-1">{gw.label}</span>
                    {isActive && (
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSel ? 'bg-green-300' : 'bg-green-500'}`} />
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── Right: Settings Form ───────────────────────────────────────── */}
          <div className="flex-1 min-w-0">
            {/* Form header */}
            <div className="bg-[#173d59] text-white rounded-t-xl px-5 py-3 flex items-center gap-2">
              <svg className="w-4 h-4 text-blue-300" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <span className="font-semibold text-sm">
                {selectedGW?.label} Payment Gateway Settings
              </span>
              {gwConfig?.updated_at && (
                <span className="ml-auto text-xs text-blue-200 hidden md:block">
                  সর্বশেষ: {new Date(gwConfig.updated_at).toLocaleDateString('bn-BD')}
                </span>
              )}
            </div>

            <form onSubmit={handleSave} className="bg-gray-50 border border-t-0 border-slate-200 rounded-b-xl p-5 space-y-4">
              {/* Row 1: Info Card + Status + Date */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

                {/* ── Gateway Information Card ────────────────────────────── */}
                <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-4">
                    Set <span className="text-[#1d435d]">"Payment Gateway"</span> Information
                  </h3>
                  <div className="space-y-4">

                    {/* Gateway Type */}
                    <div>
                      <label className={LBL}>Gateway Type {REQ}</label>
                      <select
                        className={INP}
                        value={form.gateway_type || ''}
                        onChange={e => setField('gateway_type', e.target.value)}
                        required
                      >
                        {typeOptions.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Sandbox / Live — শুধু API types-এ দেখাবে */}
                    {hasSandbox && (
                      <div>
                        <label className={LBL}>Set Sandbox/Live? {REQ}</label>
                        <div className="flex items-center gap-8 mt-1">
                          <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                            <input
                              type="radio"
                              name="sandbox_live"
                              value="sandbox"
                              checked={form.sandbox_live === 'sandbox'}
                              onChange={() => setField('sandbox_live', 'sandbox')}
                              className="w-4 h-4 text-[#1d435d] border-gray-300 focus:ring-[#1d435d]"
                            />
                            Sandbox
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                            <input
                              type="radio"
                              name="sandbox_live"
                              value="live"
                              checked={form.sandbox_live === 'live'}
                              onChange={() => setField('sandbox_live', 'live')}
                              className="w-4 h-4 text-[#1d435d] border-gray-300 focus:ring-[#1d435d]"
                            />
                            Live
                          </label>
                        </div>
                      </div>
                    )}

                    {/* App Key — শুধু API types-এ দেখাবে */}
                    {hasAppKeys && (
                      <div>
                        <label className={LBL}>App Key (X-APP-Key) {REQ}</label>
                        <input
                          type="text"
                          className={INP}
                          placeholder={`Enter ${selectedGW?.label} App_Key`}
                          value={form.app_key || ''}
                          onChange={e => setField('app_key', e.target.value)}
                        />
                      </div>
                    )}

                    {/* App Secret — শুধু API types-এ দেখাবে */}
                    {hasAppKeys && (
                      <div>
                        <label className={LBL}>App Secret (Secret Key) {REQ}</label>
                        <PasswordInput
                          value={form.app_secret_plain || ''}
                          onChange={e => setField('app_secret_plain', e.target.value)}
                          placeholder={`Enter ${selectedGW?.label} Secret_Key`}
                        />
                      </div>
                    )}

                    {/* Merchant Number — Platform Connector/non-API types-এ দেখাবে */}
                    {hasMerchant && (
                      <div>
                        <label className={LBL}>Merchant Number {REQ}</label>
                        <input
                          type="text"
                          className={INP}
                          placeholder={`Enter ${selectedGW?.label} Merchant Number`}
                          value={form.merchant_number || ''}
                          onChange={e => setField('merchant_number', e.target.value)}
                        />
                      </div>
                    )}

                    {/* Payment URL — Mobile App-এ সরাসরি redirect */}
                    <div>
                      <label className={LBL}>📱 Mobile App Payment URL</label>
                      <input
                        type="url"
                        className={INP}
                        placeholder="https://payment.bkash.com/..."
                        value={form.payment_url || ''}
                        onChange={e => setField('payment_url', e.target.value)}
                      />
                      <p className="text-xs text-gray-400 mt-1">Mobile app-এ এই gateway ক্লিক করলে এই URL-এ যাবে</p>
                    </div>

                    {/* Username — সব type-এ দেখাবে */}
                    <div>
                      <label className={LBL}>Username {REQ}</label>
                      <input
                        type="text"
                        className={INP}
                        placeholder="Username"
                        value={form.username || ''}
                        onChange={e => setField('username', e.target.value)}
                      />
                    </div>

                    {/* Password — সব type-এ দেখাবে */}
                    <div>
                      <label className={LBL}>Password {REQ}</label>
                      <PasswordInput
                        value={form.password_plain || ''}
                        onChange={e => setField('password_plain', e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* ── Right column: Enable/Disable + Dates ─────────────────── */}
                <div className="space-y-4">

                  {/* Enabling/Disabling status */}
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                    <h3 className="text-sm font-semibold text-gray-700 mb-4">
                      Set Payment <span className="text-[#1d435d]">"Enabling/Disabling"</span> status
                    </h3>
                    <div className="space-y-3">
                      {[
                        { val: true,  labelText: 'Payment Enabled',  color: 'bg-green-100', icon: '✓', iconColor: 'text-green-600' },
                        { val: false, labelText: 'Payment Disabled', color: 'bg-red-100',   icon: '✕', iconColor: 'text-red-500' },
                      ].map(({ val, labelText, color, icon, iconColor }) => (
                        <label key={String(val)} className="flex items-center gap-3 cursor-pointer">
                          <div
                            className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${form.is_active === val ? 'border-blue-500' : 'border-gray-300'}`}
                          >
                            {form.is_active === val && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                          </div>
                          <input
                            type="radio" name="is_active" className="sr-only"
                            checked={form.is_active === val}
                            onChange={() => setField('is_active', val)}
                          />
                          <span className="flex items-center gap-2 text-sm text-gray-700">
                            <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${color} text-xs font-bold ${iconColor}`}>
                              {icon}
                            </span>
                            {labelText}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Activation & Expiry Date */}
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                    <h3 className="text-sm font-semibold text-gray-700 mb-4">
                      Set <span className="text-[#1d435d]">"Activation"</span> and{' '}
                      <span className="text-[#1d435d]">"Expiry"</span> date
                    </h3>
                    <div className="space-y-3">
                      <div>
                        <label className={LBL}>Activation Date {REQ}</label>
                        <input
                          type="date" className={INP} required
                          value={form.activation_date || ''}
                          onChange={e => setField('activation_date', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className={LBL}>Expiry Date</label>
                        <input
                          type="date" className={INP}
                          value={form.expiry_date || ''}
                          onChange={e => setField('expiry_date', e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 2: Applicable For */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-700">
                    Set <span className="text-[#1d435d]">"Payment Gateway"</span> applicable for:
                  </h3>
                  <span className="text-xs text-blue-600 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    Before setting this please read the info carefully
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { field: 'applicable_admin_portal',  label: 'Admin Customer (Portal)' },
                    { field: 'applicable_pop_portal',    label: 'POP (Portal)' },
                    { field: 'applicable_bandwidth_pop', label: 'Bandwidth POP (Portal)' },
                    { field: 'applicable_pop_client',    label: 'POP Client (Portal)' },
                  ].map(({ field, label }) => (
                    <label
                      key={field}
                      className="flex items-center gap-2.5 cursor-pointer p-3 rounded-lg border border-gray-200 hover:border-[#1d435d] hover:bg-blue-50 transition-colors group"
                    >
                      <input
                        type="checkbox"
                        checked={!!form[field]}
                        onChange={e => setField(field, e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-[#1d435d] focus:ring-[#1d435d]"
                      />
                      <span className="text-sm text-gray-700 group-hover:text-[#1d435d] font-medium">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Save Button */}
              <div className="flex justify-center pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 bg-[#173d59] hover:bg-[#1f5075] disabled:opacity-60 text-white font-semibold px-8 py-2.5 rounded-full text-sm transition-colors shadow"
                >
                  {saving ? (
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {saving ? 'সংরক্ষণ হচ্ছে...' : 'Save or Update'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
