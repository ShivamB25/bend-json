import Base
import ./LAWS.bend as Laws

# These reductions exercise the real public encoder, then the real parser,
# with the fixed limits in LAWS; there are no success premises or shortcuts.
def Laws.Json.bool_roundtrip(b):
  match b:
    case False{}:
      {==}
    case True{}:
      {==}

def Laws.Json.null_roundtrip():
  {==}

def Laws.Json.empty_array_roundtrip():
  {==}

def Laws.Json.empty_object_roundtrip():
  {==}

# The first parameter shrinks. The suffixes occur only in types/proofs.
def append_assoc(a: String, -b: String, -c: String) -> {String.append(String.append(a, b), c) == String.append(a, String.append(b, c)) : String}:
  match a:
    case SNil{}:
      {==}
    case SCon{h, t}:
      %append_assoc(t, b, c) : {SCon{h, String.append(String.append(t, b), c)} == SCon{h, _} : String}
      {==}

def append_right_identity(s: String) -> {String.append(s, SNil{}) == s : String}:
  match s:
    case SNil{}:
      {==}
    case SCon{h, t}:
      %append_right_identity(t) : {SCon{h, String.append(t, SNil{})} == SCon{h, _} : String}
      {==}

# IH: X == Y, where X is the tail accumulator and Y is its specification.
# Associativity gives Z == Y, so symmetry and transitivity yield X == Z.
# The law's reusable String binders also make the matched head/tail reusable.
def Laws.Json.string_reverse_accumulator(s, acc):
  match s:
    case SNil{}:
      {==}
    case SCon{h, t}:
      ih = Laws.Json.string_reverse_accumulator(t, SCon{h, acc})
      assoc = append_assoc(Laws.Spec.reverse(t), SCon{h, SNil{}}, acc)
      sym_assoc = Equal.sym(
        String,
        String.append(String.append(Laws.Spec.reverse(t), SCon{h, SNil{}}), acc),
        String.append(Laws.Spec.reverse(t), SCon{h, acc}),
        assoc)
      Equal.trans(
        String,
        String.reverse.go(t, SCon{h, acc}),
        String.append(Laws.Spec.reverse(t), SCon{h, acc}),
        String.append(String.append(Laws.Spec.reverse(t), SCon{h, SNil{}}), acc),
        ih,
        sym_assoc)

# Specializing the accumulator theorem to empty and removing the empty suffix
# connects the public Base finalizer to the independent specification.
def string_reverse_finalizer(+s: String) -> {String.reverse(s) == Laws.Spec.reverse(s) : String}:
  Equal.trans(
    String,
    String.reverse(s),
    String.append(Laws.Spec.reverse(s), SNil{}),
    Laws.Spec.reverse(s),
    Laws.Json.string_reverse_accumulator(s, SNil{}),
    append_right_identity(Laws.Spec.reverse(s)))
