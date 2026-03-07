import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Users, Plus, Trash2, UserPlus, Crown, Eye, Edit3, X, ChevronDown } from "lucide-react";
import type { Team, TeamMember, TeamRole } from "../types";
import { fetchTeams, createTeam, deleteTeam, fetchTeamMembers, addTeamMember, removeTeamMember } from "../lib/api";

interface Props {
  token?: string;
  userId?: string;
}

const ROLE_LABELS: Record<TeamRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

const ROLE_ICONS: Record<TeamRole, React.ReactNode> = {
  owner: <Crown size={12} />,
  editor: <Edit3 size={12} />,
  viewer: <Eye size={12} />,
};

export default function TeamsPanel({ token, userId }: Props) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create team form
  const [showCreate, setShowCreate] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [creating, setCreating] = useState(false);

  // Add member form
  const [showAddMember, setShowAddMember] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("viewer");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const loadTeams = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTeams(token);
      setTeams(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load teams");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadMembers = useCallback(async (teamId: string) => {
    if (!token) return;
    try {
      const data = await fetchTeamMembers(teamId, token);
      setMembers(data);
    } catch {
      setMembers([]);
    }
  }, [token]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  useEffect(() => {
    if (selectedTeam) loadMembers(selectedTeam.id);
  }, [selectedTeam, loadMembers]);

  const handleCreateTeam = async () => {
    if (!token || !newTeamName.trim()) return;
    setCreating(true);
    try {
      const team = await createTeam(newTeamName.trim(), token);
      setTeams((prev) => [team, ...prev]);
      setNewTeamName("");
      setShowCreate(false);
      setSelectedTeam(team);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create team");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteTeam = async (team: Team) => {
    if (!token || !confirm(`Delete team "${team.name}"? This cannot be undone.`)) return;
    try {
      await deleteTeam(team.id, token);
      setTeams((prev) => prev.filter((t) => t.id !== team.id));
      if (selectedTeam?.id === team.id) setSelectedTeam(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete team");
    }
  };

  const handleAddMember = async () => {
    if (!token || !selectedTeam || !inviteEmail.trim()) return;
    setInviting(true);
    setInviteError(null);
    try {
      const member = await addTeamMember(selectedTeam.id, inviteEmail.trim(), inviteRole, token);
      setMembers((prev) => [...prev, member]);
      setInviteEmail("");
      setShowAddMember(false);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (member: TeamMember) => {
    if (!token || !selectedTeam) return;
    try {
      await removeTeamMember(selectedTeam.id, member.user_id, token);
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    }
  };

  if (!token) {
    return (
      <div className="teams-empty">
        <Users size={32} style={{ opacity: 0.3 }} />
        <p>Sign in to manage teams</p>
      </div>
    );
  }

  return (
    <div className="teams-panel">
      {/* Header */}
      <div className="teams-header">
        <div>
          <h3 style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--text)" }}>Teams</h3>
          <p style={{ fontSize: "0.78rem", color: "var(--text-3)", marginTop: 2 }}>
            Collaborate and share scrapers with your team
          </p>
        </div>
        <button
          className="btn btn-primary"
          style={{ fontSize: "0.8rem", gap: 6 }}
          onClick={() => setShowCreate(true)}
        >
          <Plus size={14} />
          New Team
        </button>
      </div>

      {error && (
        <div className="teams-error">
          <span>{error}</span>
          <button onClick={() => setError(null)}><X size={12} /></button>
        </div>
      )}

      {/* Create team form */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            className="teams-create-form"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <input
              className="input"
              placeholder="Team name…"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateTeam()}
              autoFocus
              style={{ fontSize: "0.85rem" }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn btn-primary"
                style={{ fontSize: "0.8rem", flex: 1 }}
                onClick={handleCreateTeam}
                disabled={creating || !newTeamName.trim()}
              >
                {creating ? "Creating…" : "Create"}
              </button>
              <button
                className="btn btn-ghost"
                style={{ fontSize: "0.8rem" }}
                onClick={() => { setShowCreate(false); setNewTeamName(""); }}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="teams-layout">
        {/* Teams list */}
        <div className="teams-list">
          {loading ? (
            <div className="teams-loading">
              <div className="spinner" style={{ width: 18, height: 18 }} />
            </div>
          ) : teams.length === 0 ? (
            <div className="teams-empty-list">
              <Users size={24} style={{ opacity: 0.25 }} />
              <span>No teams yet</span>
            </div>
          ) : (
            teams.map((team) => (
              <button
                key={team.id}
                className={`teams-list-item${selectedTeam?.id === team.id ? " active" : ""}`}
                onClick={() => setSelectedTeam(team)}
              >
                <div className="teams-list-item-icon">
                  <Users size={14} />
                </div>
                <div className="teams-list-item-info">
                  <span className="teams-list-item-name">{team.name}</span>
                  <span className="teams-list-item-role">
                    {team.owner_id === userId ? "Owner" : "Member"}
                  </span>
                </div>
                <ChevronDown size={12} style={{ opacity: 0.4, transform: "rotate(-90deg)" }} />
              </button>
            ))
          )}
        </div>

        {/* Team detail */}
        <AnimatePresence mode="wait">
          {selectedTeam ? (
            <motion.div
              key={selectedTeam.id}
              className="team-detail"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.2 }}
            >
              {/* Team header */}
              <div className="team-detail-header">
                <div>
                  <h4 style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text)" }}>
                    {selectedTeam.name}
                  </h4>
                  <span style={{ fontSize: "0.72rem", color: "var(--text-4)", fontFamily: "var(--font-mono)" }}>
                    {selectedTeam.id.slice(0, 8)}…
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {selectedTeam.owner_id === userId && (
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: "0.78rem", gap: 5, color: "var(--step-error)" }}
                      onClick={() => handleDeleteTeam(selectedTeam)}
                    >
                      <Trash2 size={13} />
                      Delete
                    </button>
                  )}
                </div>
              </div>

              {/* Members */}
              <div className="team-members-section">
                <div className="team-members-title">
                  <span>Members ({members.length})</span>
                  {selectedTeam.owner_id === userId && (
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: "0.75rem", gap: 5 }}
                      onClick={() => setShowAddMember(true)}
                    >
                      <UserPlus size={13} />
                      Add
                    </button>
                  )}
                </div>

                {/* Add member form */}
                <AnimatePresence>
                  {showAddMember && (
                    <motion.div
                      className="add-member-form"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <input
                        className="input"
                        placeholder="Email address…"
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        style={{ fontSize: "0.82rem" }}
                      />
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <select
                          className="input"
                          value={inviteRole}
                          onChange={(e) => setInviteRole(e.target.value as "editor" | "viewer")}
                          style={{ fontSize: "0.82rem", flex: 1 }}
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                        </select>
                        <button
                          className="btn btn-primary"
                          style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}
                          onClick={handleAddMember}
                          disabled={inviting || !inviteEmail.trim()}
                        >
                          {inviting ? "Adding…" : "Add"}
                        </button>
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: "0.8rem" }}
                          onClick={() => { setShowAddMember(false); setInviteEmail(""); setInviteError(null); }}
                        >
                          Cancel
                        </button>
                      </div>
                      {inviteError && (
                        <p style={{ fontSize: "0.78rem", color: "var(--step-error)", margin: 0 }}>{inviteError}</p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Members list */}
                <div className="members-list">
                  {members.map((member) => (
                    <div key={member.id} className="member-row">
                      <div className="member-avatar">
                        <span>{((member.user?.display_name ?? member.user?.email ?? "?")[0] ?? "?").toUpperCase()}</span>
                      </div>
                      <div className="member-info">
                        <span className="member-name">
                          {member.user?.display_name ?? member.user?.email?.split("@")[0] ?? "Unknown"}
                        </span>
                        <span className="member-email">{member.user?.email}</span>
                      </div>
                      <div className={`member-role role-${member.role}`}>
                        {ROLE_ICONS[member.role]}
                        <span>{ROLE_LABELS[member.role]}</span>
                      </div>
                      {selectedTeam.owner_id === userId && member.user_id !== userId && (
                        <button
                          className="btn btn-ghost btn-icon"
                          style={{ opacity: 0.5, padding: "4px 6px" }}
                          onClick={() => handleRemoveMember(member)}
                          title="Remove member"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="no-team"
              className="team-detail-empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Users size={28} style={{ opacity: 0.2 }} />
              <span>Select a team to view details</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
