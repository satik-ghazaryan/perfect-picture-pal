from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest import mock

import chat_answer
from chat_answer import ChatAnswerRequest, _search, answer_public_chat, build_chat_messages


def _tour(tour_id: str, title: str, location: str, aliases: list[str], price: int | None = 8000) -> dict:
    return {
        "id": tour_id,
        "title": title,
        "location": location,
        "aliases": aliases,
        "price": price,
        "priceMissing": f"{title} տուրի գինը դեռ հրապարակված չէ։",
        "departureLine": "Մոտակա մեկնումը՝ նոյեմբերի 29-ին, 08:00։",
        "seatLine": "Ազատ է 17 տեղ։",
        "programLine": "Ծրագիր։",
        "link": f"/tours/{tour_id}",
    }


TOURS = [
    _tour("dilijan-autumn", "Աշնանային Դիլիջան՝ Արմավիրից", "Դիլիջան", ["դիլիջան", "տավուշ"]),
    _tour("garni", "Արմավիր – Գառնի, Գեղարդ և Քարերի Սիմֆոնիա", "Գառնի", ["գառնի", "գեղարդ"], None),
]


def _reply(content: str | None = None, tool_calls: list | None = None):
    message = SimpleNamespace(content=content, tool_calls=tool_calls or [])
    message.model_dump = lambda **_: {"role": "assistant", "content": content, "tool_calls": []}
    return SimpleNamespace(choices=[SimpleNamespace(message=message)])


def _call(name: str, **arguments):
    return SimpleNamespace(id=f"call-{name}", function=SimpleNamespace(name=name, arguments=json.dumps(arguments)))


class ChatAnswerTests(unittest.TestCase):
    def test_search_finds_declined_and_misspelled_places(self) -> None:
        catalog = TOURS
        for query, expected in [
            ("դիլիջանում ինչ կա", ["dilijan-autumn"]),
            ("Դիլիջյան", ["dilijan-autumn"]),
            ("գեղարթ", ["garni"]),
            ("Գառնիի տուրը", ["garni"]),
            ("Սևան", []),
        ]:
            self.assertEqual([row["id"] for row in _search(catalog, query)["tours"]], expected, query)

    def test_model_sees_the_catalog_the_current_tour_and_the_whole_recent_conversation(self) -> None:
        history = []
        for index in range(12):
            history.append({"role": "user", "text": f"հարց {index}"})
            history.append({"role": "assistant", "text": f"պատասխան {index}"})
        body = ChatAnswerRequest(
            message="իսկ գի՞նը",
            history=history,
            selectedTourId="dilijan-autumn",
            tours=TOURS,
        )
        messages, _ = build_chat_messages(body)
        system = messages[0]["content"]
        self.assertIn("dilijan-autumn | Աշնանային Դիլիջան՝ Արմավիրից", system)
        self.assertIn("garni | Արմավիր – Գառնի", system)
        self.assertIn("currently looking at / talking about: Աշնանային Դիլիջան", system)
        self.assertEqual(len(messages), 1 + chat_answer.HISTORY_TURNS + 1)
        self.assertEqual(messages[1]["content"], "հարց 4")
        self.assertEqual(messages[-1], {"role": "user", "content": "իսկ գի՞նը"})

    def test_phone_numbers_never_reach_the_model(self) -> None:
        body = ChatAnswerRequest(
            message="զանգեք +374 94 123456",
            history=[{"role": "user", "text": "իմ համարը 094 12 34 56"}],
            tours=TOURS,
        )
        messages, _ = build_chat_messages(body)
        joined = " ".join(item["content"] for item in messages[1:])
        self.assertNotRegex(joined, r"\d{5,}")

    def test_asks_for_the_answer_when_the_model_only_keeps_calling_tools(self) -> None:
        create = mock.Mock(
            side_effect=[
                _reply(tool_calls=[_call("get_price", tour_id="dilijan-autumn", party=2)]),
                _reply(tool_calls=[_call("get_seats", tour_id="dilijan-autumn")]),
                _reply(tool_calls=[_call("get_departures", tour_id="dilijan-autumn")]),
                _reply(tool_calls=[_call("suggest_action", action="booking", tour_id="dilijan-autumn")]),
                _reply("Երկուսով կլինի 16000 դրամ։"),
            ]
        )
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        with mock.patch.dict("os.environ", {"OPENAI_API_KEY": "test"}), mock.patch.object(
            chat_answer, "OpenAI", return_value=client
        ):
            result = answer_public_chat(ChatAnswerRequest(message="երկուսով ինչ արժե", tours=TOURS))
        self.assertEqual(result["reply"], "Երկուսով կլինի 16000 դրամ։")
        self.assertEqual(result["suggest"], "booking")
        self.assertEqual(create.call_args.kwargs["tool_choice"], "none")
        self.assertEqual([call["name"] for call in result["calls"]][0], "get_price")

    def test_chat_model_and_temperature_can_be_set_separately(self) -> None:
        with mock.patch.dict("os.environ", {"CHAT_MODEL": "chat-x", "OPENAI_MODEL": "ideas-y", "CHAT_TEMPERATURE": "9"}):
            self.assertEqual(chat_answer._chat_model(), "chat-x")
            self.assertEqual(chat_answer._temperature(), 1.0)
        with mock.patch.dict("os.environ", {"OPENAI_MODEL": "ideas-y"}, clear=True):
            self.assertEqual(chat_answer._chat_model(), "ideas-y")
            self.assertEqual(chat_answer._temperature(), 0.4)


if __name__ == "__main__":
    unittest.main()
