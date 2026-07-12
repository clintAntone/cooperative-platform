import { useState } from 'react'
import { Header } from '../../components/layout/Header'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import {
  useDamayanEvents,
  useAllDamayanAssessments,
  useCreateDamayanEvent,
  useRecordDamayanPayment,
  useWaiveDamayanAssessment,
} from '../../hooks/useDamayan'
import type { DamayanAssessmentWithMeta } from '../../hooks/useDamayan'
import type { DamayanEvent } from '../../types'
import { useCurrency } from '../../hooks/useCurrency'
import { PageGuide } from '../../components/shared/PageGuide'
import { formatDate, formatDateTime } from '../../lib/utils'

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  paid:    'bg-green-100 text-green-800',
  waived:  'bg-gray-100 text-gray-600',
}

export function DamayanAdminPage() {
  const { format: currency } = useCurrency()
  const { data: events = [], isLoading: eventsLoading } = useDamayanEvents()

  const [selectedEvent, setSelectedEvent] = useState<DamayanEvent | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [payTarget, setPayTarget] = useState<DamayanAssessmentWithMeta | null>(null)
  const [waiveTarget, setWaiveTarget] = useState<DamayanAssessmentWithMeta | null>(null)
  const [waiveNote, setWaiveNote] = useState('')

  // Create form state
  const [form, setForm] = useState({
    title: '',
    description: '',
    event_date: new Date().toISOString().slice(0, 10),
    assessment_amount: '',
    affected_member_id: '',
  })

  const { data: assessments = [], isLoading: assessmentsLoading } = useAllDamayanAssessments(selectedEvent?.id ?? null)

  const createEvent = useCreateDamayanEvent()
  const recordPayment = useRecordDamayanPayment()
  const waiveAssessment = useWaiveDamayanAssessment()

  const handleCreate = () => {
    if (!form.title || !form.event_date || !form.assessment_amount) return
    createEvent.mutate({
      title: form.title,
      description: form.description || null,
      affected_member_id: form.affected_member_id || null,
      event_date: form.event_date,
      assessment_amount: parseFloat(form.assessment_amount),
    }, {
      onSuccess: () => {
        setShowCreateModal(false)
        setForm({ title: '', description: '', event_date: new Date().toISOString().slice(0, 10), assessment_amount: '', affected_member_id: '' })
      },
      onError: (err: any) => alert(err.message ?? 'Failed to create event'),
    })
  }

  const pendingCount = assessments.filter(a => a.status === 'pending').length
  const paidCount = assessments.filter(a => a.status === 'paid').length
  const totalAssessed = assessments.reduce((s, a) => s + a.amount_due, 0)
  const totalPaid = assessments.reduce((s, a) => s + a.amount_paid, 0)

  return (
    <div>
      <Header
        title="Damayan (Mutual Aid)"
        subtitle="Manage mutual aid events and member assessments"
        actions={
          <Button size="sm" onClick={() => setShowCreateModal(true)}>
            + New Event
          </Button>
        }
      />

      <div className="p-4 sm:p-6 space-y-4">
        <PageGuide
          storageKey="damayan"
          steps={[
            "Damayan is the cooperative's mutual aid fund. When a member passes away or faces a qualifying event, all active members contribute a fixed amount.",
            'Create a new Damayan event with a title, event date, affected member, and per-member assessment amount.',
            'On creation, assessments are automatically generated for every active member (excluding the affected member).',
            "Mark individual assessments as 'Paid' when you receive the contribution, or 'Waive' for hardship cases (admin only).",
          ]}
          note="All active members at the time of event creation are assessed. Members who join later are not added retroactively."
        />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Events list */}
        <div className="lg:col-span-1 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Events</h2>
          {eventsLoading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-gray-400">No damayan events yet.</p>
          ) : events.map(event => (
            <button
              key={event.id}
              onClick={() => setSelectedEvent(event)}
              className={`w-full text-left bg-white rounded-xl border px-4 py-3.5 transition-colors ${
                selectedEvent?.id === event.id
                  ? 'border-blue-500 ring-1 ring-blue-500'
                  : 'border-gray-200 hover:border-blue-300'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900 truncate">{event.title}</p>
                <span className={`flex-shrink-0 inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${event.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {event.status}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">{formatDate(event.event_date)}</p>
              <p className="text-xs text-gray-500 mt-0.5">Assessment: {currency(event.assessment_amount)} / member</p>
            </button>
          ))}
        </div>

        {/* Assessments for selected event */}
        <div className="lg:col-span-2">
          {!selectedEvent ? (
            <div className="flex items-center justify-center h-48 text-sm text-gray-400">
              Select an event to view assessments
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
                <h3 className="font-semibold text-gray-900 text-sm">{selectedEvent.title}</h3>
                {selectedEvent.description && <p className="text-xs text-gray-500 mt-1">{selectedEvent.description}</p>}
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-500">Total Assessed</p>
                    <p className="font-semibold">{currency(totalAssessed)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Total Paid</p>
                    <p className="font-semibold text-green-700">{currency(totalPaid)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Pending</p>
                    <p className="font-semibold text-yellow-700">{pendingCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Paid</p>
                    <p className="font-semibold text-green-700">{paidCount}</p>
                  </div>
                </div>
              </div>

              <Card className="overflow-x-auto">
                {assessmentsLoading ? (
                  <p className="text-sm text-gray-400 text-center py-8">Loading assessments…</p>
                ) : assessments.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">No assessments found.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Member</th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Amount Due</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Paid At</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {assessments.map(a => (
                        <tr key={a.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900">{a.profile?.full_name ?? '—'}</p>
                            {a.profile?.employee_id && <p className="text-xs text-gray-500">{a.profile.employee_id}</p>}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold">{currency(a.amount_due)}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusColors[a.status]}`}>
                              {a.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs">
                            {a.paid_at ? formatDateTime(a.paid_at) : '—'}
                          </td>
                          <td className="px-4 py-3">
                            {a.status === 'pending' && (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setPayTarget(a)}
                                  className="text-xs text-green-600 hover:text-green-800 font-medium"
                                >
                                  Mark Paid
                                </button>
                                <span className="text-gray-300">|</span>
                                <button
                                  onClick={() => { setWaiveTarget(a); setWaiveNote('') }}
                                  className="text-xs text-gray-500 hover:text-gray-700 font-medium"
                                >
                                  Waive
                                </button>
                              </div>
                            )}
                            {a.notes && <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{a.notes}</p>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Create event modal */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create Damayan Event" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Bereavement — Juan Dela Cruz"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              rows={2}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Optional details about the event…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Event Date <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={form.event_date}
                onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Assessment Amount <span className="text-red-500">*</span></label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.assessment_amount}
                onChange={e => setForm(f => ({ ...f, assessment_amount: e.target.value }))}
                placeholder="0.00"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <p className="text-xs text-gray-500">
            An assessment of the specified amount will be created for every active member except the affected member (if specified).
          </p>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button
              className="flex-1"
              loading={createEvent.isPending}
              disabled={!form.title || !form.event_date || !form.assessment_amount}
              onClick={handleCreate}
            >
              Create Event
            </Button>
          </div>
        </div>
      </Modal>

      {/* Mark paid modal */}
      <Modal isOpen={!!payTarget} onClose={() => setPayTarget(null)} title="Mark Assessment as Paid" size="sm">
        {payTarget && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Mark the {currency(payTarget.amount_due)} assessment for <strong>{payTarget.profile?.full_name}</strong> as paid?
            </p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setPayTarget(null)}>Cancel</Button>
              <Button
                className="flex-1"
                loading={recordPayment.isPending}
                onClick={() => recordPayment.mutate({ assessmentId: payTarget.id }, {
                  onSuccess: () => setPayTarget(null),
                  onError: (err: any) => alert(err.message ?? 'Failed to record payment'),
                })}
              >
                Mark Paid
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Waive modal */}
      <Modal isOpen={!!waiveTarget} onClose={() => setWaiveTarget(null)} title="Waive Assessment" size="sm">
        {waiveTarget && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Waive the {currency(waiveTarget.amount_due)} assessment for <strong>{waiveTarget.profile?.full_name}</strong>?
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
              <textarea
                rows={2}
                value={waiveNote}
                onChange={e => setWaiveNote(e.target.value)}
                placeholder="Reason for waiver…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setWaiveTarget(null)}>Cancel</Button>
              <Button
                variant="danger"
                className="flex-1"
                loading={waiveAssessment.isPending}
                onClick={() => waiveAssessment.mutate({ assessmentId: waiveTarget.id, notes: waiveNote || undefined }, {
                  onSuccess: () => setWaiveTarget(null),
                  onError: (err: any) => alert(err.message ?? 'Failed to waive assessment'),
                })}
              >
                Waive
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
