gp_registers = ["eax", "ebx", "ecx", "edx", "esi", "edi", "esp", "ebp"];
all_registers = gp_registers.slice(0);
all_registers.push("eip", "eflags");

flag_descriptions = {
    "CF": "Carry flag",
    "PF": "Parity flag",
    "AF": "Adjust flag",
    "ZF": "Zero flag",
    "SF": "Sign flag",
    "TF": "Trap flag",
    "IF": "Interrupt enable flag",
    "DF": "Direction flag",
    "OF": "Overflow flag",
    "IOPL": "I/O privilege level",
    "NT": "Nested task flag",
    "RF": "Resume flag",
    "VM": "Virtual 8086 mode flag",
    "AC": "Alignment check",
    "VIF": "Virtual interrupt flag",
    "VIP": "Virtual interrupt pending",
    "ID": "Able to use CPUID"
}

function hex(v) {
    var parts = new Array(8);
    for (var i = 0; i < 8; i++) {
        parts[8 - i] = (v & 0xf).toString(16);
        v >>= 4;
    }
    return "0x" + parts.join("");
}

var MAX_STACK = 10;

function State (prevState) {
    this.prevState = prevState;
    var self = this;
    if (prevState) {
        self.stack = prevState.stack.slice(0);
        all_registers.forEach(function (reg) {
            self[reg] = prevState[reg];
        });
        for (var flag in flag_descriptions) {
            self[flag] = prevState[flag];
        }
    } else {
        self.stack = new Array(MAX_STACK);
        for (var i = 0; i < MAX_STACK; i++) {
            self.stack[i] = 0;
        }
        for (var flag in flag_descriptions) {
            self[flag] = false;
        }
        self.IF = true;
        self.eax = 0; self.ebx = 0; self.ecx = 0; self.esi = 0; self.edi = 0;
        self.esp = self.stackBase; self.ebp = self.stackBase;
        self.eip = self.codeBase;
    }
}

State.prototype.stackBase = 0xfffffe00;
State.prototype.codeBase = 0x8040a00;
State.prototype.toString = function () {
    var self = this;
    var ret = "";
    for (var stackIndex = 0; stackIndex < this.stack.length; stackIndex++) {
        ret += hex(self.stackBase - (stackIndex << 2));
        ret += ": " + hex(self.stack[stackIndex]) + "\n";
    }
    gp_registers.slice(0,4).forEach(function (v) {
        ret += v + ": " + hex(self[v]) + " ";
    });
    ret += "\n";
    gp_registers.slice(4).forEach(function (v) {
        ret += v + ": " + hex(self[v]) + " ";
    });
    ret += "\n";
    ret += "eip: " + hex(self.eip) + " ";

    ret += "eflags: " ;
    for (var flag in flag_descriptions) {
        if (self[flag]) {
            ret += flag + " ";
        }
    }
    ret += "\n";
    return ret;
}

State.prototype.push = function(val) {
    stackIndex = (this.stackBase - this.esp) >> 2;
    this.stack[stackIndex] = val;
    this.esp -= 4;
}

State.prototype.pop = function() {
    stackIndex = (this.stackBase - this.esp) >> 2;
    this.esp += 4;
    return this.stack[stackIndex];
}

function Command(regex, callback) {
    regex = regex.replace("REG", "%(" + all_registers.join("|") + ")");
    // We need to dobule escape here for some reason.
    regex = regex.replace("IMM", "\\$(0x\\d+|\\d+)");
    regex = "^" + regex + "$";
    this.regex = new RegExp(regex, "i");
    this.callback = callback;
}

var commands = [
    new Command("pushl? REG", function (state, reg) {
        state.push(state[reg]);
    }),
    new Command("pushl? IMM", function (state, imm) {
        state.push(parseInt(imm));
    }),
    new Command("popl? REG", function (state, reg) {
        state[reg] = state.pop();
    }),
    new Command("movl? IMM, ?REG", function(state, imm, reg) {
        state[reg] = parseInt(imm);
    }),
    new Command("movl? REG, ?REG", function(state, src, dst) {
        state[dst] = state[src];
    }),
    new Command("xorl? REG, ?REG", function(state, src, dst) {
        state[dst] ^= state[src];
    }),
    new Command("addl? REG, ?REG", function(state, src, dst) {
        state[dst] += state[src];
    }),
    new Command("addl? IMM, ?REG", function(state, imm, dst) {
        state[dst] += parseInt(imm);
    }),
    new Command("call IMM", function(state, imm) {
        state.push(state.eip);
        state.eip = parseInt(imm);
    }),
    new Command("ret", function(state) {
        state.eip = state.pop();
    }),
    ];

State.prototype.eval = function (string) {
    var newState = new State(this);
    var matched = commands.some(function (command) {
        var found = string.match(command.regex);
        if (found) {
            var args = [newState];
            args.push.apply(args, found.slice(1));
            newState.eip += 4;
            command.callback.apply(this, args);
            return true;
        }
        return false;
    });
    if (matched) {
        return newState;
    } else {
        throw "No matching command for " + string;
    }
}
