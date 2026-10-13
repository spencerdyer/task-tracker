"""The project chat between the owner and the agents. Agents post updates and answers; each turn an
agent asks for its unread messages (the owner's, to it or to everyone) and marks them read."""
from helpers import API, project, token_for


def test_an_agent_posts_the_owner_answers_and_the_agent_reads_its_reply(client, agent, captured):
    sent = captured
    project(client)
    planner = agent(token_for(client)["token"])
    ticket = planner.post(f"{API}/projects/DEMO/tickets", json={"author": "planner", "title": "Polish the reader"}).json()["key"]

    res = planner.post(f"{API}/projects/DEMO/chat", json={"author": "planner", "body": f"Started **{ticket}**; next up after that is DEMO-999."})
    assert res.status_code == 200, res.text
    first = res.json()
    assert first["author"] == "planner" and first["to"] is None and first["token"] == "agents"
    assert [t["key"] for t in first["tickets"]] == [ticket]  # keys in the text become cards; unknown keys don't
    assert first["tickets"][0]["title"] == "Polish the reader"
    assert sent[-1][0] == "tracker_chat" and sent[-1][1]["kind"] == "message" and sent[-1][1]["author"] == "planner"

    # The owner sees it as unread, then replies to the planner with an @mention
    assert client.get(f"{API}/projects/DEMO/chat/unread").json()["count"] == 1
    reply = client.post(f"{API}/projects/DEMO/chat", json={"author": "anything", "body": "@planner sounds good, ship it"}).json()
    assert reply["author"] == "user" and reply["to"] == "planner"
    assert client.get(f"{API}/projects/DEMO/chat/unread").json()["count"] == 0  # replying reads what came before
    to_all = client.post(f"{API}/projects/DEMO/chat", json={"body": "Everyone: quiet hours after 11."}).json()
    other = client.post(f"{API}/projects/DEMO/chat", json={"body": "Just for you", "to": "@painter"}).json()
    assert other["to"] == "painter"

    # The planner's unread: the reply to it and the message to everyone, not the painter's
    unread = planner.get(f"{API}/projects/DEMO/chat/unread", params={"for": "planner"}).json()
    assert [m["id"] for m in unread["messages"]] == [reply["id"], to_all["id"]] and unread["count"] == 2
    painter = planner.get(f"{API}/projects/DEMO/chat/unread", params={"for": "painter"}).json()
    assert [m["id"] for m in painter["messages"]] == [to_all["id"], other["id"]]  # not the reply meant for the planner
    done = planner.post(f"{API}/projects/DEMO/chat/read", json={"author": "planner", "upto": unread["upto"]}).json()
    assert done["upto"] == to_all["id"] and done["unread"] == 0
    assert planner.get(f"{API}/projects/DEMO/chat/unread", params={"for": "planner"}).json()["count"] == 0
    assert sent[-1][1] == {"project": "DEMO", "kind": "read", "for": "planner", "upto": to_all["id"]}
    # The marker never goes back
    assert planner.post(f"{API}/projects/DEMO/chat/read", json={"author": "planner", "upto": 1}).json()["upto"] == to_all["id"]

    # Posting also counts as reading: a later owner message is unread again until the agent answers
    later = client.post(f"{API}/projects/DEMO/chat", json={"body": "One more thing"}).json()
    assert [m["id"] for m in planner.get(f"{API}/projects/DEMO/chat/unread", params={"for": "planner"}).json()["messages"]] == [later["id"]]
    planner.post(f"{API}/projects/DEMO/chat", json={"author": "planner", "body": "On it."})
    assert planner.get(f"{API}/projects/DEMO/chat/unread", params={"for": "planner"}).json()["count"] == 0

    # The whole conversation, newest last, and paging
    page = planner.get(f"{API}/projects/DEMO/chat").json()
    assert [m["author"] for m in page["messages"]] == ["planner", "user", "user", "user", "user", "planner"]
    assert page["more_before"] is False
    newer = planner.get(f"{API}/projects/DEMO/chat", params={"since": later["id"]}).json()["messages"]
    assert [m["body"] for m in newer] == ["On it."]
    older = planner.get(f"{API}/projects/DEMO/chat", params={"before": later["id"], "limit": 2}).json()
    assert [m["id"] for m in older["messages"]] == [to_all["id"], other["id"]] and older["more_before"] is True


def test_tokens_need_can_comment_and_cannot_post_as_the_owner(client, agent):
    project(client)
    quiet = agent(token_for(client, can_comment=False)["token"])
    res = quiet.post(f"{API}/projects/DEMO/chat", json={"author": "reader", "body": "hello"})
    assert res.status_code == 403
    # It can still read the chat and its unread messages
    assert quiet.get(f"{API}/projects/DEMO/chat").status_code == 200
    assert quiet.get(f"{API}/projects/DEMO/chat/unread", params={"for": "reader"}).status_code == 200

    loud = agent(token_for(client)["token"])
    assert loud.post(f"{API}/projects/DEMO/chat", json={"author": "user", "body": "I approve"}).status_code == 403
    assert loud.post(f"{API}/projects/DEMO/chat", json={"author": "User", "body": "I approve"}).status_code == 403
    assert loud.post(f"{API}/projects/DEMO/chat", json={"body": "nameless"}).status_code == 400
    assert loud.post(f"{API}/projects/DEMO/chat", json={"author": "x", "body": "   "}).status_code == 400
    assert loud.post(f"{API}/projects/DEMO/chat", json={"author": "x", "body": "y" * 20001}).status_code == 400
    # A token only reaches its own project
    project(client, "OPS", "Operations")
    assert loud.get(f"{API}/projects/OPS/chat").status_code == 404
    assert loud.post(f"{API}/projects/OPS/chat", json={"author": "x", "body": "hi"}).status_code == 404


def test_ticket_cards_only_from_this_project(client):
    project(client)
    project(client, "OPS", "Operations")
    mine = client.post(f"{API}/projects/DEMO/tickets", json={"title": "Here"}).json()["key"]
    theirs = client.post(f"{API}/projects/OPS/tickets", json={"title": "Elsewhere"}).json()["key"]
    msg = client.post(f"{API}/projects/DEMO/chat", json={"body": f"see {theirs} and {mine}", "tickets": [mine, "DEMO-404"]}).json()
    assert [t["key"] for t in msg["tickets"]] == [mine]
