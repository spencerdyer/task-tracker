"""Database models: the owner, sessions, and the tracker's projects, tickets, history, chat and questions.

Every tracker row carries ``user_id`` (always the single owner, 1, today) so that more accounts can be
added later without changing the tables.
"""
from __future__ import annotations

from sqlalchemy import (JSON, Boolean, Column, DateTime, Float, ForeignKey, Index, Integer, String, Text,
                        UniqueConstraint, func)
from sqlalchemy.ext.declarative import declared_attr
from sqlalchemy.orm import declarative_base

Base = declarative_base()

OWNER_ID = 1


class OwnedMixin:
    """Rows that belong to an account. There is one owner today (``OWNER_ID``)."""

    @declared_attr
    def user_id(cls):
        return Column(Integer, nullable=False, default=OWNER_ID, index=True)


class Owner(Base):
    """The one person who signs in. Agents use project tokens instead."""
    __tablename__ = "owner"

    id = Column(Integer, primary_key=True)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class OwnerSession(Base):
    """A signed-in browser. Only a SHA-256 of the session token is stored."""
    __tablename__ = "owner_sessions"

    id = Column(Integer, primary_key=True)
    token_hash = Column(String, nullable=False, unique=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    last_used_at = Column(DateTime(timezone=True), nullable=True)


class Setting(Base):
    """Small owner settings as JSON by name (e.g. which projects the board shows)."""
    __tablename__ = "settings"

    name = Column(String, primary_key=True)
    value = Column(JSON, nullable=True)


class TrackerProject(OwnedMixin, Base):
    __tablename__ = "tracker_projects"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_tracker_projects_user_key"),)

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, nullable=False)  # 2-10 capitals/digits, e.g. DEMO
    name = Column(String, nullable=False)
    description = Column(Text, nullable=False, default="")
    next_number = Column(Integer, nullable=False, default=1)
    created = Column(Float, nullable=False)  # unix seconds


class TrackerTicket(OwnedMixin, Base):
    __tablename__ = "tracker_tickets"
    __table_args__ = (
        UniqueConstraint("user_id", "key", name="uq_tracker_tickets_user_key"),
        Index("ix_tracker_tickets_project_status", "project_id", "status"),
    )

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("tracker_projects.id", ondelete="CASCADE"), nullable=False)
    key = Column(String, nullable=False)  # DEMO-12
    title = Column(String, nullable=False)
    scope = Column(Text, nullable=False, default="")
    acceptance = Column(Text, nullable=False, default="")
    priority = Column(String, nullable=False, default="P2")
    owner = Column(String, nullable=False, default="")
    labels = Column(JSON, nullable=False, default=list)
    depends_on = Column(JSON, nullable=False, default=list)
    resources = Column(JSON, nullable=True, default=list)  # keys of the project's shared machines it needs
    status = Column(String, nullable=False, default="todo")
    rank = Column(Float, nullable=False, default=0)
    reopened = Column(Integer, nullable=False, default=0)
    created = Column(Float, nullable=False)
    updated = Column(Float, nullable=False)


class TrackerResource(OwnedMixin, Base):
    """A shared machine a project's tickets may need, e.g. a GPU box or a test device.
    It is held while any ticket needing it is in progress or testing."""
    __tablename__ = "tracker_resources"
    __table_args__ = (UniqueConstraint("user_id", "project_id", "key", name="uq_tracker_resources_project_key"),)

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("tracker_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    key = Column(String, nullable=False)  # gpu-box, test-phone
    name = Column(String, nullable=False)
    description = Column(Text, nullable=False, default="")
    created = Column(Float, nullable=False)


class TrackerEvent(OwnedMixin, Base):
    __tablename__ = "tracker_events"
    __table_args__ = (Index("ix_tracker_events_ticket_ts", "ticket_id", "ts"),)

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tracker_tickets.id", ondelete="CASCADE"), nullable=False)
    ts = Column(Float, nullable=False)
    author = Column(String, nullable=False)  # 'user' for the owner, else the agent's name
    kind = Column(String, nullable=False)  # created | status | comment | note | verification | edit
    body = Column(Text, nullable=False, default="")
    status_from = Column(String, nullable=True)
    status_to = Column(String, nullable=True)
    token_id = Column(Integer, ForeignKey("tracker_tokens.id", ondelete="SET NULL"), nullable=True)
    token_name = Column(String, nullable=True)  # kept after the token is revoked or deleted


class TrackerAttachment(OwnedMixin, Base):
    __tablename__ = "tracker_attachments"

    id = Column(String, primary_key=True)  # uuid hex
    event_id = Column(Integer, ForeignKey("tracker_events.id", ondelete="CASCADE"), nullable=False)
    ticket_id = Column(Integer, ForeignKey("tracker_tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String, nullable=False)
    mime = Column(String, nullable=False)
    size = Column(Integer, nullable=False)
    storage_path = Column(String, nullable=False)  # relative to the data folder


class TrackerToken(OwnedMixin, Base):
    """A project access token for agents (``tt_…``). It reaches only /api/tracker,
    only its project, only what its switches allow, and never approves (that is the
    signed-in owner's alone). Only a SHA-256 of the token is stored."""
    __tablename__ = "tracker_tokens"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("tracker_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    prefix = Column(String, nullable=False)
    token_hash = Column(String, nullable=False, unique=True, index=True)
    can_create = Column(Boolean, nullable=False, default=True)
    can_edit = Column(Boolean, nullable=False, default=True)
    can_move = Column(Boolean, nullable=False, default=True)
    can_comment = Column(Boolean, nullable=False, default=True)
    owner_only = Column(String, nullable=True)  # set: writes only to tickets with this owner
    expires_at = Column(DateTime(timezone=True), nullable=True)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    last_used_ip = Column(String, nullable=True)
    last_author = Column(String, nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class TrackerMessage(OwnedMixin, Base):
    """A message in a project's chat between the owner and the agents."""
    __tablename__ = "tracker_messages"
    __table_args__ = (Index("ix_tracker_messages_project_id", "project_id", "id"),)

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("tracker_projects.id", ondelete="CASCADE"), nullable=False)
    ts = Column(Float, nullable=False)
    author = Column(String, nullable=False)  # 'user' for the owner, else the agent's name
    to_agent = Column(String, nullable=True)  # who it is for (an agent name, or the owner); empty: everyone
    body = Column(Text, nullable=False, default="")  # Markdown
    tickets = Column(JSON, nullable=True)  # ticket keys shown as cards
    token_id = Column(Integer, ForeignKey("tracker_tokens.id", ondelete="SET NULL"), nullable=True)
    token_name = Column(String, nullable=True)


class TrackerChatRead(OwnedMixin, Base):
    """How far one reader (an agent name, or 'user') has read a project's chat."""
    __tablename__ = "tracker_chat_reads"
    __table_args__ = (UniqueConstraint("user_id", "project_id", "reader", name="uq_tracker_chat_reads_reader"),)

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("tracker_projects.id", ondelete="CASCADE"), nullable=False)
    reader = Column(String, nullable=False)
    upto = Column(Integer, nullable=False, default=0)  # the last message id read
    ts = Column(Float, nullable=False)


class TrackerQuestion(OwnedMixin, Base):
    """A question an agent asks the owner on a ticket: context, options and the agent's recommendation,
    answered in a thread. open (waiting for the owner) | answered (the owner replied last) | resolved | withdrawn."""
    __tablename__ = "tracker_questions"
    __table_args__ = (Index("ix_tracker_questions_project_status", "project_id", "status"),
                      Index("ix_tracker_questions_ticket", "ticket_id"))

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("tracker_projects.id", ondelete="CASCADE"), nullable=False)
    ticket_id = Column(Integer, ForeignKey("tracker_tickets.id", ondelete="CASCADE"), nullable=False)
    asked_by = Column(String, nullable=False)  # the agent's name
    title = Column(String, nullable=False)
    body = Column(Text, nullable=False, default="")  # Markdown: context, options, recommendation
    options = Column(JSON, nullable=True)  # [{label, detail}]
    recommended = Column(String, nullable=True)  # an option's label
    status = Column(String, nullable=False, default="open")
    created = Column(Float, nullable=False)
    updated = Column(Float, nullable=False)
    waiting_since = Column(Float, nullable=False)  # when it last became open (for "waiting longest first")
    answered_at = Column(Float, nullable=True)
    closed_at = Column(Float, nullable=True)
    closed_by = Column(String, nullable=True)
    token_id = Column(Integer, ForeignKey("tracker_tokens.id", ondelete="SET NULL"), nullable=True)
    token_name = Column(String, nullable=True)


class TrackerQuestionReply(OwnedMixin, Base):
    """One message in a question's thread: the owner's answer (with the option they chose) or the agent's."""
    __tablename__ = "tracker_question_replies"
    __table_args__ = (Index("ix_tracker_question_replies_question", "question_id", "id"),)

    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, ForeignKey("tracker_questions.id", ondelete="CASCADE"), nullable=False)
    ts = Column(Float, nullable=False)
    author = Column(String, nullable=False)  # 'user' for the owner, else the agent's name
    body = Column(Text, nullable=False, default="")
    choice = Column(String, nullable=True)  # the option's label the owner picked
    token_id = Column(Integer, ForeignKey("tracker_tokens.id", ondelete="SET NULL"), nullable=True)
    token_name = Column(String, nullable=True)
