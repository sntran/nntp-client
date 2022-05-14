import {
  StringReader,
} from "./deps.ts";

import {
  assert,
  assertEquals,
  assertObjectMatch,
} from "./dev_deps.ts";

import { Response } from "./response.ts";
import { MultiLineResponseCodes } from "./model.ts";

Deno.test("Response", async (t) => {
   await t.step("status", async (t) => {
    await t.step("is anything passed to constructor",() => {
      for (let status = 100; status < 600; status++) {
        const response = new Response(new StringReader(""), { status });
        assertEquals(response.status, status);
      }
    });
  });

  await t.step("headers", async (t) => {
    await t.step("is anything passed to constructor",() => {
      const headers = new Headers({
        "foo": "bar",
        "bar": "foo",
      });
      const response = new Response(new StringReader(""), { headers });
      assertObjectMatch(Object.fromEntries(response.headers), Object.fromEntries(headers));
    });
  });

  await t.step("body", async (t) => {
    await t.step("is empty from empty reader", async () => {
      const response = new Response(new StringReader(""));
      const body = await response.text();
      assert(!body);
    });

    await t.step("is empty with non multi-line status and any reader", async () => {
      const response = new Response(new StringReader("foobar"), {
        status: 200,
      });
      const body = await response.text();
      assert(!body);
    });

    await t.step("is empty with 211 status (generated by GROUP command) and any reader", async () => {
      const response = new Response(new StringReader("foobar"), {
        status: 211,
      });
      const body = await response.text();
      assert(!body);
    });

    await t.step("is empty from reader of single dot", async () => {
      for await (const status of MultiLineResponseCodes) {
        const response = new Response(new StringReader("."), { status });
        const body = await response.text();
        assert(!body);
      }
    });

    await t.step("is empty from reader of terminating line", async () => {
      for await (const status of MultiLineResponseCodes) {
        const response = new Response(new StringReader(".\r\n"), { status });
        const body = await response.text();
        assert(!body);
      }
    });

    await t.step("is full line from reader of line before terminating line", async () => {
      for await (const status of MultiLineResponseCodes) {
        const response = new Response(new StringReader("foobar\r\n.\r\n"), { status });
        const body = await response.text();
        assertEquals(body, "foobar\r\n");
      }
    });

    await t.step("undo dot-stuffing", async () => {
      for await (const status of MultiLineResponseCodes) {
        const response = new Response(new StringReader("..foobar\r\n.\r\n"), { status });
        const body = await response.text();
        assertEquals(body, ".foobar\r\n");
      }
    });

    await t.step("is full line with 211 status (generated by LISTGROUP command) and special statusText", async () => {
      let response = new Response(new StringReader("foobar\r\n.\r\n"), {
        status: 211,
        statusText: "articles follow",
      });
      let body = await response.text();
      assertEquals(body, "foobar\r\n");

      response = new Response(new StringReader("foobar\r\n.\r\n"), {
        status: 211,
        statusText: "list below",
      });
      body = await response.text();
      assertEquals(body, "foobar\r\n");
    });

    await t.step("can also take a ReadableStream as body and just return new Response from it", async () => {
      const status = 101;
      const statusText = "capabilities follow";
      let response = new Response(new StringReader("foobar\r\n.\r\n"), {
        status,
        statusText,
      });

      response = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
      });

      assertEquals(response.status, status);
      assertEquals(response.statusText, statusText);
      const body = await response.text();
      assertEquals(body, "foobar\r\n");
    });
  });
});

Deno.test("Response.from", async (t) => {

  await t.step("status", async (t) => {
    await t.step("is a three-digit status indicator", async () => {
      for (let status = 100; status < 600; status++) {
        const response = await Response.from(new StringReader(`${ status }`));
        assertEquals(response.status, status);
      }
    });

    await t.step("MAY have any text after the response code", async (t) => {
      const response = await Response.from(new StringReader(`205 closing connection`));
      assertEquals(response.status, 205);
      assertEquals(response.statusText, "closing connection");
    });
  });

  await t.step("headers", async (t) => {
    function getReader(lines: string[]) {
      return new StringReader(lines.join("\r\n") + "\r\n");
    }

    await t.step("is empty when status not 220 or 221", async () => {
      for (let status = 100; status < 600 && status !== 220 && status !== 221; status++) {
        const response = await Response.from(new StringReader(`${ status }`));
        assertObjectMatch(response.headers, {});
      }
    });

    await t.step("is empty when input is empty", async () => {
      const reader = getReader([
        `221`,
        `.`,
      ]);
      const response = await Response.from(reader);
      assertObjectMatch(response.headers, {});
    });

    await t.step("is empty from reader of terminating line", async () => {
      const reader = getReader([
        `221`,
        `.`,
      ]);
      const response = await Response.from(reader);
      assertObjectMatch(response.headers, {});
    });

    await t.step("consists of one or more header lines", async () => {
      const reader = getReader([
        `221`,
        `path: pathost!demo!whitehouse!not-for-mail`,
        `.`,
      ]);
      const response = await Response.from(reader);
      const headers = response.headers;
      assertObjectMatch(Object.fromEntries(headers), {
        "path": "pathost!demo!whitehouse!not-for-mail",
      });
    });

    await t.step("is normalized to lowercase name", async () => {
      const reader = getReader([
        `221`,
        `Path: pathost!demo!whitehouse!not-for-mail`,
        `From: "Demo User" <nobody@example.net>`,
        `Newsgroups: misc.test`,
        `Subject: I am just a test article`,
        `Date: 6 Oct 1998 04:38:40 -0500`,
        `Organization: An Example Net, Uncertain, Texas`,
        `Message-ID: <45223423@example.com>`,
        `.`,
      ]);
      const response = await Response.from(reader);
      const headers = response.headers;

      assertObjectMatch(Object.fromEntries(headers), {
        "path": "pathost!demo!whitehouse!not-for-mail",
        "from": `"Demo User" <nobody@example.net>`,
        "newsgroups": "misc.test",
        "subject": "I am just a test article",
        "date": "6 Oct 1998 04:38:40 -0500",
        "organization": "An Example Net, Uncertain, Texas",
        "message-id": "<45223423@example.com>",
      });
    });

    await t.step("is separated from the body by a single empty line", async () => {
      const reader = getReader([
        `221`,
        `Path: pathost!demo!whitehouse!not-for-mail`,
        `From: "Demo User" <nobody@example.net>`,
        `Newsgroups: misc.test`,
        `Subject: I am just a test article`,
        `Date: 6 Oct 1998 04:38:40 -0500`,
        `Organization: An Example Net, Uncertain, Texas`,
        `Message-ID: <45223423@example.com>`,
        ``,
        `This is just a test article.`,
        `.`,
      ]);

      const response = await Response.from(reader);
      const headers = response.headers;

      assertObjectMatch(Object.fromEntries(headers), {
        "path": "pathost!demo!whitehouse!not-for-mail",
        "from": `"Demo User" <nobody@example.net>`,
        "newsgroups": "misc.test",
        "subject": "I am just a test article",
        "date": "6 Oct 1998 04:38:40 -0500",
        "organization": "An Example Net, Uncertain, Texas",
        "message-id": "<45223423@example.com>",
      });

      const body = await response.text();
      assertEquals(body, "This is just a test article.\r\n");
    });
  });
});
